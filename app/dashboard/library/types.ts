export type ResumeRow = {
  id: string;
  label: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
};

export type JdRow = {
  id: string;
  label: string;
  companyName: string | null;
  roleTitle: string | null;
  rawText: string;
  createdAt: string;
};
