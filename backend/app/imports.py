from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account
from app.schemas import ImportConfirmRequest, ImportPreview, TransactionOut
from app.services import imports as import_service
from app.transactions import _transaction_out

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
    return [_transaction_out(session, account, transaction) for transaction in created]
