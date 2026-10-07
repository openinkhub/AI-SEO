import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

// Create arrives as multipart/form-data (the bill file rides along), so every
// value is a string here and parsed in the service.
export class CreateInvoiceDto {
  @Matches(/^\d{1,2}$/, { message: 'Pick a month (M0-M12).' })
  monthIndex: string;

  @Matches(DATE, { message: 'Invoice date must look like YYYY-MM-DD.' })
  invoiceDate: string;

  @IsString()
  @MinLength(1, { message: 'Invoice number is required.' })
  @MaxLength(64)
  invoiceNo: string;

  @Matches(AMOUNT, { message: 'Amount must be a number with up to 2 decimals.' })
  amount: string;

  @IsOptional()
  @IsIn(['paid', 'unpaid'])
  status?: string;

  @IsOptional()
  @ValidateIf((o) => o.paidDate !== '')
  @Matches(DATE, { message: 'Paid date must look like YYYY-MM-DD.' })
  paidDate?: string;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @Matches(/^\d{1,2}$/, { message: 'Pick a month (M0-M12).' })
  monthIndex?: string;

  @IsOptional()
  @Matches(DATE, { message: 'Invoice date must look like YYYY-MM-DD.' })
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  invoiceNo?: string;

  @IsOptional()
  @Matches(AMOUNT, { message: 'Amount must be a number with up to 2 decimals.' })
  amount?: string;

  @IsOptional()
  @IsIn(['paid', 'unpaid'])
  status?: string;

  @IsOptional()
  @ValidateIf((o) => o.paidDate !== '')
  @Matches(DATE, { message: 'Paid date must look like YYYY-MM-DD.' })
  paidDate?: string;
}
