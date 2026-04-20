"use client";

import * as React from "react";
import { FileText, Mic } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { JdList } from "./JdList";
import { ResumeList } from "./ResumeList";
import type { JdRow, ResumeRow } from "./types";

export function LibraryTabs({
  initialResumes,
  initialJobDescriptions,
}: {
  initialResumes: ResumeRow[];
  initialJobDescriptions: JdRow[];
}) {
  return (
    <Tabs defaultValue="resumes" className="w-full">
      <TabsList>
        <TabsTrigger value="resumes" className="gap-2">
          <FileText className="h-4 w-4" />
          Resumes
          <span className="ml-1 rounded-full bg-muted px-2 text-xs text-muted-foreground">
            {initialResumes.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="jds" className="gap-2">
          <Mic className="h-4 w-4" />
          Job descriptions
          <span className="ml-1 rounded-full bg-muted px-2 text-xs text-muted-foreground">
            {initialJobDescriptions.length}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="resumes">
        <ResumeList initialResumes={initialResumes} />
      </TabsContent>
      <TabsContent value="jds">
        <JdList initialJobDescriptions={initialJobDescriptions} />
      </TabsContent>
    </Tabs>
  );
}
