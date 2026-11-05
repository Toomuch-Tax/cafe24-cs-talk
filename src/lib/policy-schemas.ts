import { z } from "zod";

export const Slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "영문 소문자·숫자·하이픈");
export const Kind = z.enum(["always", "topic", "product"]);
export const Mode = z.enum(["auto", "draft", "off"]);
export const Categories = z.array(z.enum(["shipping", "return", "exchange", "defect", "restock", "size", "etc"])).max(7);
export const Content = z.string().max(20000);
export const Products = z
  .array(z.object({ no: z.number().int().positive(), name: z.string().trim().max(200), image: z.string().url().max(500).nullish() }))
  .max(50);
