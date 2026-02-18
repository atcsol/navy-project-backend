import { NotFoundException } from '@nestjs/common';

/**
 * Busca um registro ou lança NotFoundException
 * Elimina o padrão repetitivo: find → if !result → throw
 */
export async function findOrThrow<T>(
  findFn: () => Promise<T | null>,
  errorMessage: string,
): Promise<T> {
  const result = await findFn();
  if (!result) {
    throw new NotFoundException(errorMessage);
  }
  return result;
}
