import { extendApi } from "@anatine/zod-openapi";
import { ChatRole, MessageStatus } from "@prisma/client";
import z from "zod";
import { ChatActionsSchema, ChatCitationsSchema } from "../chat-message-extras";
import { ATTACHMENTS_PER_MESSAGE } from "../chat-attachments/attachment-rules";

export const CreateChatMessageDto = extendApi(
  z.object({
    chatId: z.string().uuid().describe("Chat ID to attach this message"),
    role: z.enum(ChatRole).describe("Role of the message sender"),
    text: z.string().min(1, "Message text is required").optional().describe("Message text"),
    status: z
      .enum(MessageStatus)
      .optional()
      .describe("Status of the message"),
    attachmentIds: z
      .array(z.string().uuid())
      .max(ATTACHMENTS_PER_MESSAGE)
      .optional()
      .describe("Uploaded images to send with this message"),
  }),
  {
    title: "CreateChatMessageRequest",
    example: {
      chatId: "d14b1c32-78f2-4a92-a35b-cc0c788ab123",
      role: "user",
      text: "Hello AI, can you help me with this step?",
      status: "sent",
    },
  }
);

export const UpdateChatMessageDto = extendApi(
  z.object({
    text: z.string().min(1, "Updated text is required").describe("Updated message text"),
    status: z
      .enum(MessageStatus)
      .optional()
      .describe("Updated status of the message"),
  }),
  {
    title: "UpdateChatMessageRequest",
    example: {
      text: "Updated message text",
      fileUrls: ["https://example.com/updated-file.png"],
    },
  }
);


export const InternalUpdateChatMessageDto = UpdateChatMessageDto.extend({
  citations: ChatCitationsSchema.nullable().optional(),
  actions: ChatActionsSchema.nullable().optional(),
}).strict();

export type InternalUpdateChatMessageDtoType = z.infer<typeof InternalUpdateChatMessageDto>;
export type CreateChatMessageDtoType = z.infer<typeof CreateChatMessageDto>;
export type UpdateChatMessageDtoType = z.infer<typeof UpdateChatMessageDto>;

