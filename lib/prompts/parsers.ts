/**
 * Loose parsers for Resume and JobDescription text. Runs in the background
 * after upload via Next.js `after()`. Output is saved on `Resume.parsedData`
 * / `JobDescription.parsedData`. Failures are tolerated — prep works from
 * raw text when parsed data is null.
 */
import { z } from "zod";

export const resumeParsedSchema = z.object({
  fullName: z.string().min(1).max(120).nullable().optional(),
  headline: z.string().min(1).max(200).nullable().optional(),
  yearsOfExperience: z.number().int().min(0).max(60).nullable().optional(),
  skills: z.array(z.string().min(1).max(80)).max(60).optional(),
  roles: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        company: z.string().min(1).max(120),
        durationYears: z.number().min(0).max(40).nullable().optional(),
        highlights: z.array(z.string().min(1).max(300)).max(6).optional(),
      }),
    )
    .max(12)
    .optional(),
  education: z
    .array(
      z.object({
        institution: z.string().min(1).max(150),
        degree: z.string().min(1).max(150).nullable().optional(),
      }),
    )
    .max(6)
    .optional(),
});

export type ResumeParsed = z.infer<typeof resumeParsedSchema>;

export const jdParsedSchema = z.object({
  roleTitle: z.string().min(1).max(150).nullable().optional(),
  companyName: z.string().min(1).max(120).nullable().optional(),
  seniority: z.string().min(1).max(50).nullable().optional(),
  domain: z.string().min(1).max(80).nullable().optional(),
  mustHaves: z.array(z.string().min(2).max(200)).max(15).optional(),
  niceToHaves: z.array(z.string().min(2).max(200)).max(15).optional(),
  responsibilities: z.array(z.string().min(3).max(300)).max(15).optional(),
});

export type JdParsed = z.infer<typeof jdParsedSchema>;

export const resumeParserSystem = `You extract structured data from a plain-text resume. You return valid JSON only. If a field cannot be confidently extracted from the text, set it to null or omit it — never fabricate. If the resume is very short or unstructured, return what you can and omit the rest.`;

export function buildResumeParserUser(text: string): string {
  return JSON.stringify({
    task: "Extract the structured shape described in the system prompt from this resume.",
    resume: text,
    outputSchema: {
      fullName: "string or null",
      headline: "string or null — professional tagline if present",
      yearsOfExperience: "integer or null — approximate total",
      skills: "array of short tech/skill strings",
      roles: "array of { title, company, durationYears, highlights[] }",
      education: "array of { institution, degree }",
    },
  });
}

export const jdParserSystem = `You extract structured data from a plain-text job description. You return valid JSON only. If a field cannot be confidently extracted, omit or set null. Don't fabricate.`;

export function buildJdParserUser(text: string): string {
  return JSON.stringify({
    task: "Extract the structured shape described in the system prompt from this job description.",
    jobDescription: text,
    outputSchema: {
      roleTitle: "string or null",
      companyName: "string or null",
      seniority: "string like 'entry' | 'mid' | 'senior' | 'staff'",
      domain: "short string, e.g. 'fintech payments'",
      mustHaves: "array of short requirement strings",
      niceToHaves: "array of short preference strings",
      responsibilities: "array of short responsibility strings",
    },
  });
}
