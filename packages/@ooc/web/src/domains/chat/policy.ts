export async function waitForJob(jobId: string | undefined, fetchJob: (jobId: string) => Promise<{ status?: string }>) {
  if (!jobId) return;
  for (let i = 0; i < 20; i++) {
    const job = await fetchJob(jobId);
    if (job.status && !["queued", "running"].includes(job.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

