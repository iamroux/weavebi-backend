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
  Req,
  Query,
  Put,
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
import { UpdateDashboardQueryPositionDto } from './dto/update-dashboard-query-positions.dto';

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
    const { message } = await this.dashboardService.create(
      userId,
      createDashboardDto,
    );
    return { message };
  }

  @Get()
  @ApiOperation({ summary: 'Fetch all dashboards' })
  @ApiProperty({})
  @ApiResponse({})
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for dashboard name',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'Sort by createdAt or updatedAt',
    enum: ['createdAt', 'updatedAt']
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    type: String,
    description: 'Sort order asc or desc',
    enum: ['ASC', 'DESC']
  })
  async findAll(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'DESC'
  ) {
    const userId = req.user.id;
    return this.dashboardService.findAll(userId, page, limit, search, sortBy, sortOrder);
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
  @ApiOperation({ summary: 'Update query positions on dashboard' })
  @ApiResponse({ type: MessageDto })
  @ApiProperty({ type: UpdateDashboardQueryPositionDto })
  async updatePosition(@Body() dto: UpdateDashboardQueryPositionDto) {
    const message = await this.dashboardService.updatePosition(dto);
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
}
