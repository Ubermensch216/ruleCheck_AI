import { env } from '../config/env.js';
import { AppError } from '../errors.js';
import { runReview } from '../compliance/reviewOrchestrator.js';
import { cancelReview, getReview } from '../storage/store.js';

interface Job { reviewId: string; model: string; policyDocumentId: string; targetDocumentId: string }

class ReviewJobManager {
  private readonly queue: Job[] = [];
  private readonly active = new Map<string, AbortController>();

  enqueue(job: Job): void {
    this.queue.push(job);
    void this.pump();
  }

  cancel(reviewId: string): void {
    const index = this.queue.findIndex((job) => job.reviewId === reviewId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      cancelReview(reviewId);
      return;
    }
    const controller = this.active.get(reviewId);
    if (!controller) {
      const review = getReview(reviewId);
      if (['completed', 'failed', 'cancelled'].includes(review.status)) {
        throw new AppError('REVIEW_NOT_CANCELLABLE', '이미 종료된 검토는 취소할 수 없습니다.', 409);
      }
      throw new AppError('REVIEW_NOT_RUNNING', '실행 중인 검토가 아닙니다.', 409);
    }
    controller.abort();
    cancelReview(reviewId);
  }

  private async pump(): Promise<void> {
    while (this.active.size < env.MAX_CONCURRENT_REVIEWS && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const controller = new AbortController();
      this.active.set(job.reviewId, controller);
      void runReview(job.reviewId, job.model, job.policyDocumentId, job.targetDocumentId, controller.signal)
        .catch(() => {})
        .finally(() => {
          this.active.delete(job.reviewId);
          void this.pump();
        });
    }
  }
}

export const reviewJobs = new ReviewJobManager();
