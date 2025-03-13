import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserdbService } from './userdb.service';
import { CreateUserdbDto } from './dto/create-userdb.dto';
import { UpdateUserdbDto } from './dto/update-userdb.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MessageDto } from 'src/core/dtos/generic-response.dto';
import { AuthGuard } from 'src/core/guards/auth.guard';

@Controller('database')
@ApiTags('Database')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class UserdbController {
  constructor(private readonly userdbService: UserdbService) {}

  @Post()
  @ApiOperation({ summary: 'Create a database connection' })
  @ApiProperty({ type: CreateUserdbDto })
  @ApiResponse({ type: MessageDto })
  async create(@Request() req, @Body() createUserdbDto: CreateUserdbDto) {
    const userId = req.user.id;
    const message = await this.userdbService.create(userId, createUserdbDto);
    return { message };
  }

  @Post('test')
  @ApiOperation({ summary: 'Test a database connection' })
  @ApiProperty({ type: CreateUserdbDto })
  @ApiResponse({ type: MessageDto })
  @HttpCode(HttpStatus.OK)
  async test(@Request() req, @Body() createUserdbDto: CreateUserdbDto) {
    const userId = req.user.id;
    const message = await this.userdbService.test(userId, createUserdbDto);
    return { message };
  }

  @Get('count')
  @ApiOperation({ summary: 'Get count of database connections' })
  async getCount(@Request() req) {
    const userId = req.user.id;
    const count = await this.userdbService.getCount(userId);
    return count;
  }

  @Get()
  @ApiOperation({ summary: 'Get all database connections' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number for pagination',
    default: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page',
    default: 10,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for name or hostname',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'sort by createdAt or updatedAt',
    enum: ['createdAt', 'updatedAt'],
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    type: String,
    description: 'sort order asc or desc',
    enum: ['ASC', 'DESC'],
  })
  @ApiResponse({ type: [CreateUserdbDto] })
  async findAll(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'DESC',
  ) {
    const userId = req.user.id;
    return this.userdbService.findAll(userId, page, limit, search, sortBy, sortOrder);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a database connection' })
  @ApiProperty({ type: UpdateUserdbDto })
  @ApiResponse({ type: MessageDto })
  async update(
    @Request() req,
    @Param('id') id: number,
    @Body() updateUserdbDto: UpdateUserdbDto,
  ) {
    const userId = req.user.id;
    const message = await this.userdbService.update(
      userId,
      id,
      updateUserdbDto,
    );
    return { message };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a database from id' })
  @ApiResponse({ type: CreateUserdbDto })
  async findOne(@Request() req, @Param('id') id: number) {
    const userId = req.user.id;
    return this.userdbService.findOne(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a database connection' })
  @ApiResponse({ type: MessageDto })
  async remove(@Request() req, @Param('id') id: string) {
    const userId = req.user.id;
    const message = await this.userdbService.remove(userId, +id);
    return { message };
  }
}
