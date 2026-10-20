import type { HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthFailure {
  status: HttpStatus;
  code: string;
}

// The middleware must not throw (an error there would skip public routes too), so it records why
// a token was refused and the guard, which knows whether the route is public, answers.
const failures = new WeakMap<Request, AuthFailure>();

export const setAuthFailure = (req: Request, failure: AuthFailure): void => {
  failures.set(req, failure);
};

export const getAuthFailure = (req: Request): AuthFailure | undefined => failures.get(req);
