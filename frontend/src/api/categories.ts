/** Categories resource (issue #17). */

import { request } from './transport'

export type CategoryType = 'expense' | 'income'

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
    errorMessage: 'Could not update category',
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
