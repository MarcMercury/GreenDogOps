import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Policy/resource uploads accept files up to 25 MB (see
      // src/app/(app)/resources/policies/actions.ts). The default Server
      // Action body limit is 1 MB, which rejected larger documents before the
      // action could run, surfacing as an error page.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
