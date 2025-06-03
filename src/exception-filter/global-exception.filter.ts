// import {
//   Catch,
//   ArgumentsHost,
//   HttpException,
//   ExceptionFilter,
//   Logger,
// } from '@nestjs/common';

// @Catch()
// export class GlobalExceptionFilter implements ExceptionFilter {
//   private readonly logger = new Logger('GlobalExceptionFilter');

//   catch(error: Error, host: ArgumentsHost) {
//     this.logger.error(`Global Exception Handler: ${error.message}`);

//     const response = host.switchToHttp().getResponse();
//     if (error instanceof HttpException) {
//       const errorResponse = error.getResponse();
//       response.status(error.getStatus()).json({
//         message: errorResponse['message'] || null,
//         error: errorResponse['error'] || null,
//       });
//     } else {
//       response.status(500).json({
//         message: 'Something unexpected occurred',
//         error: 'Internal Server Error',
//       });
//     }
//   }
// }


import {
  Catch,
  ArgumentsHost,
  HttpException,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(error: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status = error instanceof HttpException ? error.getStatus() : 500;

    // Log detailed info
    this.logger.error(`[${request.method}] ${request.url}`);
    this.logger.error(`Error message: ${error.message}`);
    this.logger.error(`Stack trace: ${error.stack}`);

    // Log request body for debugging
    if (request.body) {
      this.logger.error(`Request body: ${JSON.stringify(request.body).slice(0, 1000)}`);
    }

    // Special logging for SyntaxError (e.g., bad JSON)
    if (error instanceof SyntaxError && 'body' in error) {
      this.logger.error(`❌ Malformed JSON: ${error.message}`);
    }

    // Build response
    if (error instanceof HttpException) {
      const errorResponse = error.getResponse();
      response.status(status).json({
        message: errorResponse['message'] || null,
        error: errorResponse['error'] || null,
      });
    } else {
      response.status(status).json({
        message: error.message || 'Unexpected error',
        error: 'Internal Server Error',
      });
    }
  }
}

