import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["telnyx"],
  env: {
    // Build identity, inlined at build time so every client event can report the
    // bundle it is running. Answers "is this device still on an old build?",
    // which was previously unanswerable. Vercel sets VERCEL_GIT_COMMIT_SHA; local
    // builds report 'dev'.
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 12),
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: {
    disable: true,
  },
});
