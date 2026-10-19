import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { ChatsModule } from './chats/chats.module';
import { ChatMessagesModule } from './chat-messages/chat-messages.module';
import { ContentsModule } from './contents/contents.module';
import { ChatAttachmentsModule } from './chat-attachments/chat-attachments.module';

@Module({
  imports: [
    RouterModule.register([
      {
        path: 'chat',
        children: [
          { path: '', module: ChatsModule },
          { path: '', module: ChatMessagesModule },
          { path: '', module: ContentsModule },
          { path: '', module: ChatAttachmentsModule },
        ],
      },
    ]),

    ChatsModule,
    ChatMessagesModule,
    ContentsModule,
    ChatAttachmentsModule,
  ],
  exports: [ChatsModule, ChatMessagesModule, ContentsModule, ChatAttachmentsModule],
})
export class ChatModule {}
