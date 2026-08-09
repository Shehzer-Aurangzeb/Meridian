import {
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { Public } from '../common/guards/auth.guard';
import { signSession, verifyPassword } from './session-token';

/** 30 days. Re-typing a password monthly costs nothing at one user. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

class LoginDto {
  @IsString()
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('login')
  @Public()
  // Ten attempts a minute, against the global 100. This is the one route
  // where a wrong answer is worth retrying, so it gets its own budget.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange the password for a session token' })
  login(@Body() dto: LoginDto): { token: string; expiresIn: number } {
    const stored = process.env.MERIDIAN_PASSWORD_HASH;
    const secret = process.env.MERIDIAN_TOKEN_SECRET;

    // Fail closed. Unconfigured must never mean "let them in", and it must
    // not report which half is missing either.
    if (!stored || !secret || secret.length < 16) {
      throw new UnauthorizedException('Login is not configured');
    }
    if (!verifyPassword(dto.password, stored)) {
      throw new UnauthorizedException('Invalid password');
    }

    return {
      token: signSession(secret, SESSION_TTL_SECONDS),
      expiresIn: SESSION_TTL_SECONDS,
    };
  }

  /**
   * Not public: reaching it at all means the guard accepted the credential.
   * The frontend calls this on load to decide between the app and the login
   * screen, rather than waiting for a real request to 401.
   */
  @Get('me')
  @ApiOperation({ summary: 'Verify the current credential' })
  me(): { authenticated: true } {
    return { authenticated: true };
  }
}
