import { z } from "zod";

export const signupSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters." })
    .max(80, { message: "Name is too long." })
    .trim(),
  email: z.string().email({ message: "Enter a valid email address." }).trim().toLowerCase(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters." })
    .regex(/[a-zA-Z]/, { message: "Password must include a letter." })
    .regex(/[0-9]/, { message: "Password must include a number." }),
});

export const loginSchema = z.object({
  email: z.string().email({ message: "Enter a valid email address." }).trim().toLowerCase(),
  password: z.string().min(1, { message: "Password is required." }),
});

export const startInterviewSchema = z.object({
  title: z
    .string()
    .min(2, { message: "Give this interview a short title." })
    .max(80, { message: "Title is too long." })
    .trim(),
  resumeId: z.string().uuid({ message: "Pick a resume from your library." }),
  jobDescriptionId: z
    .string()
    .uuid({ message: "Pick a job description from your library." }),
  numQuestions: z
    .number()
    .int()
    .min(1, { message: "Choose at least 1 question." })
    .max(10, { message: "Maximum 10 questions." }),
  mode: z.enum(["text", "voice"]),
});

export const submitAnswerSchema = z.object({
  sessionId: z.string().min(1),
  answer: z.string().min(1, { message: "Write or speak your answer before submitting." }).max(8000),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type StartInterviewInput = z.infer<typeof startInterviewSchema>;
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
