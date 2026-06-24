// /jobs · /jobs/new · /jobs/[id]/* (공고 관리·등록·상세) 좌측 레일 셸.
// 상세([id])도 이 레이아웃이 덮으므로 jobs/[id]/layout.tsx 는 두지 않는다(중복 방지).
export { default } from "@/app/components/AppShellLayout";
