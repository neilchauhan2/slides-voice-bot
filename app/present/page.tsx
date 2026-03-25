import { Suspense } from "react";

import { PresentClient } from "@/components/PresentClient";

export default function PresentPage() {
  return (
    <Suspense
      fallback={
        <div className="present-loading">
          <p>Loading session...</p>
        </div>
      }
    >
      <PresentClient />
    </Suspense>
  );
}
