import {
  Controller,
  Get,
  Patch,
  Delete,
  UseGuards,
  Request,
  Body,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from 'src/core/guards/auth.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
} from '@nestjs/swagger';
import { MessageDto } from 'src/core/dtos/generic-response.dto';
import { UserDto } from './dto/user.dto';

@UseGuards(AuthGuard)
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: "Get user's profile" })
  @ApiResponse({ type: UserDto })
  async getProfile(@Request() req) {
    const userId = req.user?.id;
    const user = await this.userService.findOne(userId);
    return user;
  }

  @Patch()
  @ApiOperation({ summary: 'Update user information' })
  @ApiProperty({ type: UpdateUserDto })
  @ApiResponse({ type: MessageDto })
  async update(@Request() req, @Body() updateUserDto: UpdateUserDto) {
    const userId = req.user.id;
    const message = await this.userService.update(userId, updateUserDto);
    return { message };
  }

  @Delete()
  @ApiOperation({ summary: 'Delete user account' })
  @ApiResponse({ type: MessageDto })
  async remove(@Request() req) {
    const userId = req.user.id;
    const message = await this.userService.remove(userId);
    return { message };
  }

  @Get('query-activity')
  @ApiOperation({
    summary: 'Get queries added per day in last 7 days for current user',
  })
  async getQueryActivity(@Request() req) {
    const userId = req.user.id;
    const response = await this.userService.getQueryActivity(userId);
    return response;
  }

  @Get('query_types')
  @ApiOperation({
    summary:
      'Get distribution of output types of queries created by current user',
  })
  async getQueryTypes(@Request() req) {
    const userId = req.user.id;
    const response = await this.userService.getQueryTypes(userId);
    return response;
  }
}
