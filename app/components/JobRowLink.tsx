"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { JobPinModal } from "@/app/components/JobPinModal";

// 대시보드 공고 목록 행 — 잠긴 공고는 이동 대신 PIN 팝업을 띄우고, 해제 후 이동한다.
// 잠기지 않은 공고는 일반 Link 와 동일하게 동작.
export function JobRowLink({
  jobId,
  title,
  locked,
  className,
  children,
}: {
  jobId: number;
  title: string;
  locked: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Link
        href={`/jobs/${jobId}`}
        className={className}
        onClick={
          locked
            ? (e) => {
                e.preventDefault();
                setOpen(true);
              }
            : undefined
        }
      >
        {children}
      </Link>
      {open && (
        <JobPinModal
          jobId={jobId}
          title={title}
          onClose={() => setOpen(false)}
          onUnlocked={() => {
            setOpen(false);
            router.push(`/jobs/${jobId}`);
          }}
        />
      )}
    </>
  );
}
