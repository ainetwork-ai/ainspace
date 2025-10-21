// In-memory job storage (in production, use Redis or database)
const jobs = new Map<string, {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  createdAt: Date;
}>();

// Helper function to update job status
export function updateJobStatus(jobId: string, updates: Partial<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result: string;
  error: string;
}>) {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job, updates);
  }
}

// Helper function to create new job
export function createJob(jobId: string) {
  jobs.set(jobId, {
    status: 'pending',
    createdAt: new Date()
  });
}

// Helper function to get job
export function getJob(jobId: string) {
  return jobs.get(jobId);
}

// Helper function to delete job
export function deleteJob(jobId: string) {
  jobs.delete(jobId);
}
