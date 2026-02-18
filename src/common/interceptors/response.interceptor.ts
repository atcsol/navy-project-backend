import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Decorador para marcar rotas que não devem ser wrappadas
 * (ex: redirects, streaming, etc.)
 */
export const RawResponse = () =>
  (target: object, key?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(RAW_RESPONSE_KEY, true, descriptor.value);
    }
    return descriptor;
  };

export interface StandardResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, StandardResponse<T> | T>
{
  constructor(private reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T> | T> {
    const isRaw = this.reflector.get<boolean>(
      RAW_RESPONSE_KEY,
      context.getHandler(),
    );

    if (isRaw) {
      return next.handle();
    }

    // Não interceptar respostas de WebSocket
    if (context.getType() === 'ws') {
      return next.handle();
    }

    // Verificar se a resposta já foi enviada (ex: res.redirect)
    const response = context.switchToHttp().getResponse();
    if (response.headersSent) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
