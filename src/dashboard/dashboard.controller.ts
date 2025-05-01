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
  Put,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { UpdateDashboardDto } from './dto/update-dashboard.dto';
import { AuthGuard } from 'src/core/guards/auth.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { MessageDto } from 'src/core/dtos/generic-response.dto';
import {UpdateDashboardQueryPositionsDto } from './dto/update-dashboard-query-positions.dto';
import { PaginationQueryDto } from 'src/core/dtos/pagination-query.dto';
import { UpdateDashboardQueryColorDto } from './dto/update-dashboard-query-color.dto';

@Controller('dashboard')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Post()
  @ApiOperation({ summary: 'Create a dashboard' })
  @ApiProperty({ type: CreateDashboardDto })
  @ApiResponse({ type: MessageDto })
  async create(@Request() req, @Body() createDashboardDto: CreateDashboardDto) {
    const userId = req.user.id;
    const data = await this.dashboardService.create(
      userId,
      createDashboardDto,
    );
    return data;
  }

  @Get()
  @ApiOperation({ summary: 'Fetch all dashboards' })
  @ApiProperty({})
  @ApiResponse({})
  @ApiQuery({
    name: 'isPinned',
    required: false,
    type: Boolean,
    description: 'Filter by pinned dashboards',
    default: false,
  })
  async findAll(
    @Request() req,
    @Query() query: PaginationQueryDto,
    @Query('isPinned') isPinned: boolean = false,
  ) {
    const userId = req.user.id;
    return this.dashboardService.findAll(
      userId,
      query.page ?? 1,
      query.limit ?? 10,
      query.search ?? '',
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'DESC',
      isPinned,
    );
  }

  @Get('count')
  @ApiOperation({ summary: 'Get count of database for user' })
  async getCount(@Request() req) {
    const userId = req.user.id;
    const count = await this.dashboardService.getCount(userId);
    return count;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch dashboard info' })
  @ApiProperty({})
  @ApiResponse({})
  async findOne(@Request() req, @Param('id') id: string) {
    const userId = req.user.id;
    return this.dashboardService.findOne(+id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a dashboard' })
  @ApiProperty({})
  @ApiResponse({ type: MessageDto })
  async remove(@Request() req, @Param('id') id: string) {
    const userId = req.user.id;
    const message = await this.dashboardService.remove(userId, +id);
    return { message };
  }

  @Patch('color')
  @ApiOperation({ summary: 'Update multiple query colors on dashboard' })
  @ApiResponse({ type: MessageDto })
  async updateColors(@Body() dto: UpdateDashboardQueryColorDto){
    const message = await this.dashboardService.updateColors(dto);
    return {message}
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a dashboard' })
  @ApiProperty({ type: UpdateDashboardDto })
  @ApiResponse({ type: MessageDto })
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDashboardDto: UpdateDashboardDto,
  ) {
    const userId = req.user.id;
    const message = await this.dashboardService.update(
      userId,
      +id,
      updateDashboardDto,
    );
    return { message };
  }

  @Put('position')
  @ApiOperation({ summary: 'Update multiple query positions on dashboard' })
  @ApiResponse({ type: MessageDto })
  async updatePositions(@Body() dto: UpdateDashboardQueryPositionsDto) {
    const message = await this.dashboardService.updatePositions(dto);
    return { message };
  }


  @Get('info/:id')
  @ApiOperation({
    summary: 'Fetch dashboard info ie dashboard and its associated queries',
  })
  @ApiProperty({})
  @ApiResponse({})
  async getDashboardInfo(@Request() req, @Param('id') id: string) {
    const userId = req.user.id;
    return this.dashboardService.getDashboardInfo(+id, userId);
  }

  @Patch('pin/:id')
  @ApiOperation({ summary: 'Pin and unpin a dashboard (toggle)' })
  @ApiResponse({ type: MessageDto })
  @HttpCode(HttpStatus.OK)
  async togglePin(@Request() req, @Param('id') id: string) {
    const userId = req.user.id;
    const message = await this.dashboardService.togglePin(+id, userId);
    return { message };
  }
}
