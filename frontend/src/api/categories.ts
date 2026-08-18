/** Categories resource (issue #17). */

import { ApiError, request } from './transport'

export type CategoryType = 'expense' | 'income'

/** The structured 409 a colliding rename answers (ADR-0007): a merge offer
 * carrying the surviving Category's id and how many Transactions would
 * move, not a bare "name taken" error. */
export type CategoryMergeConflictPayload = {
  message: string
  target_id: number
  transaction_count: number
}

/** A colliding rename, surfaced as a typed error so the form can offer the
 * merge instead of failing. */
export class CategoryMergeConflict extends ApiError {
  readonly targetId: number
  readonly transactionCount: number

  constructor(payload: CategoryMergeConflictPayload) {
    super(payload.message, 409, payload)
    this.targetId = payload.target_id
    this.transactionCount = payload.transaction_count
  }
}

export type Category = {
  id: number
  name: string
  type: CategoryType
  icon: string | null
  color: string
  created_at: string
}

export async function fetchCategories(token: string): Promise<Category[]> {
  const response = await request('/categories', {
    token,
    errorMessage: 'Could not load categories',
  })
  return (await response.json()) as Category[]
}

export async function createCategory(
  token: string,
  input: { name: string; type: CategoryType; icon: string; color: string },
): Promise<Category> {
  const response = await request('/categories', {
    method: 'POST',
    token,
    json: {
      name: input.name,
      type: input.type,
      icon: input.icon,
      color: input.color,
    },
    errorMessage: 'Could not create category',
  })
  return (await response.json()) as Category
}

export async function updateCategory(
  token: string,
  categoryId: number,
  input: { name: string; icon: string; color: string },
): Promise<Category> {
  try {
    const response = await request(`/categories/${categoryId}`, {
      method: 'PATCH',
      token,
      // An empty icon is sent as "" (not null): the backend treats null as
      // "unchanged" and "" as "clear the icon".
      json: {
        name: input.name,
        icon: input.icon,
        color: input.color,
      },
      readDetail: true,
      errorMessage: 'Could not update category',
    })
    return (await response.json()) as Category
  } catch (error) {
    // The merge conflict arrives as a structured detail; a plain string 409
    // (an IntegrityError race) stays a bare ApiError.
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      typeof error.detail === 'object' &&
      error.detail !== null &&
      typeof (error.detail as { target_id?: unknown }).target_id === 'number' &&
      typeof (error.detail as { transaction_count?: unknown }).transaction_count === 'number'
    ) {
      throw new CategoryMergeConflict(error.detail as CategoryMergeConflictPayload)
    }
    throw error
  }
}

/** The confirmed merge (ADR-0007): the renamed Category's Transactions move
 * to `targetId`, the renamed Category is deleted, and the target survives —
 * one atomic write on the backend. */
export async function mergeCategories(
  token: string,
  categoryId: number,
  targetId: number,
): Promise<Category> {
  const response = await request(`/categories/${categoryId}/merge`, {
    method: 'POST',
    token,
    json: { target_id: targetId },
    errorMessage: 'Could not merge categories',
  })
  return (await response.json()) as Category
}

export async function deleteCategory(token: string, categoryId: number): Promise<void> {
  await request(`/categories/${categoryId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not delete category',
  })
}
