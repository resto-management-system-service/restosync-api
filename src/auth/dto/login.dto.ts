import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@restosync.local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin123!' })
  @IsString()
  password!: string;
}
