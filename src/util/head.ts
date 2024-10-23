import { Maybe } from "monads-io";

export function head<T>(array: T[]): Maybe<T> {
  return Maybe.fromNullable(array[0]);
}
