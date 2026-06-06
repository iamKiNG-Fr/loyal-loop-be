import { nanoid } from "nanoid";

export function generateCode(length = 6) {
  return nanoid(length).toUpperCase();
}
