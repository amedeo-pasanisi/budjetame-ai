from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account
from app.schemas import (
    ImportBatchRevalidationRequest,
    ImportConfirmRequest,
    ImportPreview,
    ImportRowRevalidation,
    ImportRowValidation,
    ImportRowValidationRequest,
    TransactionOut,
)
from app.services import imports as import_service
from app.transactions import _transaction_out, _write_warning

router = APIRouter(prefix="/import", tags=["import"])


@router.post("/preview", response_model=ImportPreview)
def preview_import(
    file: UploadFile = File(...),
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> ImportPreview:
    """Parse and validate an uploaded .csv or .xlsx against the fixed template
    (T13): the response is the preview the user confirms — every row with its
    verdict (ok / error / duplicate). Nothing is inserted by this step."""
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=422, detail="The file is empty")
    try:
        raw_rows = import_service.parse_file(file.filename or "", content)
    except (import_service.UnsupportedFile, import_service.BadTemplate) as error:
        raise HTTPException(status_code=422, detail=str(error))
    rows = import_service.preview_rows(session, account.id, raw_rows)
    return ImportPreview(
        rows=rows,
        ok_count=sum(1 for row in rows if row.status == "ok"),
        error_count=sum(1 for row in rows if row.status == "error"),
        duplicate_count=sum(1 for row in rows if row.status == "duplicate"),
    )


@router.post("/validate-row", response_model=ImportRowValidation)
def validate_row(
    payload: ImportRowValidationRequest,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> ImportRowValidation:
    """Re-validate one edited row during Verification (issue #44): the row's
    Wallet/Category names are re-resolved against the Account, the CONTEXT.md
    rules re-run, and the Duplicate check applied with the final key — the
    row's fresh status and message, through the same pipeline as the Preview.
    Nothing is written."""
    return import_service.revalidate_row(
        session, account.id, payload.row, payload.earlier_rows
    )


@router.post("/revalidate-rows", response_model=list[ImportRowRevalidation])
def revalidate_rows(
    payload: ImportBatchRevalidationRequest,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[ImportRowRevalidation]:
    """Batch Revalidation (issue #76): the draft's rows plus the target row
    numbers in, every target's fresh verdict out — one call through the same
    resolution, rules, and Duplicate key as the Preview and the single-row
    re-validation, including the in-file Duplicate check against preceding
    rows. Nothing is written."""
    known = {item.row for item in payload.rows if item.row is not None}
    unknown = [str(target) for target in payload.targets if target not in known]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown target row(s): {', '.join(unknown)}",
        )
    return import_service.revalidate_rows(
        session, account.id, payload.rows, payload.targets
    )


@router.post("/confirm", response_model=list[TransactionOut], status_code=201)
def confirm_import(
    payload: ImportConfirmRequest,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[TransactionOut]:
    """Insert the confirmed rows in one transaction (T13). Any invalid or
    now-duplicate row rejects the whole batch with 422: nothing is written
    until the user confirms."""
    try:
        created = import_service.confirm_rows(session, account.id, payload.rows)
    except import_service.ImportValidationError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return [
        _transaction_out(
            session,
            account,
            transaction,
            warning=_write_warning(session, account, transaction),
        )
        for transaction in created
    ]
