import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Performance Interceptor
 * Logs request duration and warns for slow requests
 */
@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Performance');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.url;

    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;

        // Log all requests
        this.logger.log(`${method} ${url} - ${duration}ms`);

        // Warn if slow (> 2 seconds)
        if (duration > 2000) {
          this.logger.warn(`⚠️ SLOW REQUEST: ${method} ${url} took ${duration}ms`);
        }
      }),
    );
  }
}
