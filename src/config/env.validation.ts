import {
  IsNotEmpty,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { plainToInstance, Transform } from 'class-transformer';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsNumberString()
  APP_PORT?: string;

  @IsNotEmpty()
  @IsString()
  DATABASE_URL!: string;

  @IsNotEmpty()
  @IsString()
  JWT_SECRET!: string;

  @IsNotEmpty()
  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  STRIPE_BILLING_WEBHOOK_SECRET?: string;

  // Decimal tax rate (e.g. "0.18" = 18%). REQUIRED when NODE_ENV=production;
  // optional (defaults to 0) in development/test. Whenever provided, must
  // be a valid number between 0 and 1 inclusive, regardless of environment.
  // NOTE: intentionally does NOT combine @IsOptional() with @ValidateIf() —
  // that combination was a confirmed bug (see #29): @IsOptional() causes
  // validation to be skipped entirely whenever the value is undefined,
  // which would make @ValidateIf's condition irrelevant.
  @ValidateIf(
    (o) =>
      o.NODE_ENV === 'production' ||
      (o.TAX_RATE !== undefined && o.TAX_RATE !== ''),
  )
  @Transform(({ value }) =>
    value === undefined || value === '' ? value : parseFloat(value),
  )
  @IsNotEmpty({ message: 'TAX_RATE is required when NODE_ENV=production' })
  @IsNumber({}, { message: 'TAX_RATE must be a valid number' })
  @Min(0, { message: 'TAX_RATE must be between 0 and 1' })
  @Max(1, { message: 'TAX_RATE must be between 0 and 1' })
  TAX_RATE?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints || {}).join(', '))
        .join('\n')}`,
    );
  }
  return validated;
}
