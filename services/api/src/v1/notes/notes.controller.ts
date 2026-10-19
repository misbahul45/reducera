import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser } from '../auth/auth.decorator';
import { RequireOwnership } from '../common/guards/ownership.decorator';
import { CreateNoteDto, CreateNoteDtoType, NoteListQueryDto, NoteListQueryDtoType, UpdateNoteDto, UpdateNoteDtoType } from './notes.dto';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  @AuthenticatedOnly()
  create(@Body(new ZodPipe(CreateNoteDto)) dto: CreateNoteDtoType, @GetUser() user: AuthUser) {
    return this.notes.create(user.id, dto);
  }

  @Get()
  @AuthenticatedOnly()
  list(@Query(new ZodPipe(NoteListQueryDto)) query: NoteListQueryDtoType, @GetUser() user: AuthUser) {
    return this.notes.list(user.id, query);
  }

  @Get(':id')
  @RequireOwnership('note')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.notes.findOne(id);
  }

  @Patch(':id')
  @RequireOwnership('note')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateNoteDto)) dto: UpdateNoteDtoType) {
    return this.notes.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequireOwnership('note')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.notes.remove(id);
  }
}
