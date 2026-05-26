import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 로컬 dev 의 FormData 직접 업로드 경로 본문 한도. 코드 측 MAX_FILE_SIZE / MAX_ZIP_SIZE (100MB) 와 맞춤.
    // 운영(Vercel) 은 NEXT_PUBLIC_BLOB_CLIENT_UPLOAD=1 로 Blob 직업로드 + manifest(JSON 작음) 경로라 무관.
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
