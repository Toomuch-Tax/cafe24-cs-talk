import { z } from "zod";

export const QuickReply = z.object({
  shortcut: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
});
