import TelegramBot from "node-telegram-bot-api";
import { FunctionActivitiesProvider } from "task-system-package";
import stream from 'stream';

export const TelegramBotActivityGenerator = (bot: TelegramBot) => new FunctionActivitiesProvider({
    validate: async <BUTTON_NAMES extends (string | 'stop') = 'like' | 'dislike' | 'stop'>(data: { imageUrl?: string | string[], text?: string, userid: number, buttons?: BUTTON_NAMES[] }): Promise<BUTTON_NAMES | 'stop'> => {
        const buttons = data.buttons ?? ['like', 'dislike', 'stop'];
        const sendImageWithButtons = async (chatId: number, imageUrl?: string) => {
            return new Promise<BUTTON_NAMES>((resolve) => {
                const options = {
                    reply_markup: {
                        inline_keyboard: buttons.map(button => [
                            { text: button, callback_data: button }
                        ])
                    }
                };

                let messageId: number;

                const sendMessage = async () => {
                    if (imageUrl) {
                        const msg = await bot.sendPhoto(chatId, imageUrl, options).catch(() => { resolve('stop' as BUTTON_NAMES); });
                        if (msg) messageId = msg.message_id;
                    } else {
                        const msg = await bot.sendMessage(chatId, data.text ?? 'Что вы выберите?', options).catch(() => { resolve('stop' as BUTTON_NAMES); });
                        if (msg) messageId = msg.message_id;
                    }
                };

                sendMessage();

                bot.on('callback_query', async function handler(query: TelegramBot.CallbackQuery) {
                    try {
                        if (query.message?.chat.id === chatId && query.message.message_id === messageId) {
                            if (buttons.includes(query.data as any)) {
                                await bot.answerCallbackQuery(query.id, { text: 'Вы выбрали ' + query.data + '!' });
                                await bot.deleteMessage(chatId, query.message.message_id).catch(() => { });
                                resolve(query.data as BUTTON_NAMES);
                                bot.removeListener('callback_query', handler);
                            }
                        }
                    } catch (err) { resolve('stop' as BUTTON_NAMES); }
                });
            });
        };

        if (!Array.isArray(data.imageUrl)) {
            return await sendImageWithButtons(data.userid, data.imageUrl);
        }
        const mediaGroup = data.imageUrl.slice(0, 5).map(url => ({
            type: 'photo',
            media: url
        } as TelegramBot.InputMediaPhoto));

        let mediaMessages: TelegramBot.Message[] = [];

        const messages = await bot.sendMediaGroup(data.userid, mediaGroup)
        mediaMessages = messages;
        // Группируем кнопки: первая строка - 1 кнопка, остальные - по 3
        const buttonRows = [];
        buttonRows.push([{
            text: buttons[0],
            callback_data: buttons[0]
        }]);
        for (let i = 1; i < buttons.length; i += 3) {
            buttonRows.push(
                buttons.slice(i, i + 3).map(button => ({
                    text: button,
                    callback_data: button
                }))
            );
        }
        const validationMessage = await bot.sendMessage(data.userid, data.text ?? 'Что вы выберите?', {
            reply_markup: {
                inline_keyboard: buttonRows
            }
        });


        const result = await new Promise<BUTTON_NAMES>(async (resolve) => {
            const handler = async (query: TelegramBot.CallbackQuery) => {
                try {
                    if (query.message?.chat.id === data.userid && query.message.message_id === validationMessage?.message_id) {
                        if (buttons.includes(query.data as any)) {
                            await bot.answerCallbackQuery(query.id, { text: 'Вы выбрали ' + query.data + '!' });

                            // Delete all messages
                            await Promise.all([
                                ...mediaMessages.map(msg =>
                                    bot.deleteMessage(data.userid, msg.message_id).catch(err => console.error('Error deleting media message:', err))
                                ),
                                validationMessage && bot.deleteMessage(data.userid, validationMessage.message_id).catch(err => console.error('Error deleting validation message:', err))
                            ]);

                            bot.removeListener('callback_query', handler);
                            resolve(query.data as BUTTON_NAMES);
                        }
                    }
                } catch (err) {
                    console.error('Error in callback query:', err);
                    bot.removeListener('callback_query', handler);
                    resolve('stop' as BUTTON_NAMES);
                }
            };

            bot.on('callback_query', handler);
        });
        return result;
    },


    sendMessage: async (data: { message: string, file?: { base64: string, name: string }, userid: number, deleteTimeout?: number, pin?: boolean }) => {
        let message: TelegramBot.Message | undefined;
        console.log("Sending message to user " + data.message);
        try {
            message = await bot.sendMessage(data.userid, data.message, { parse_mode: 'Markdown' });
        } catch (error) {
            message = await bot.sendMessage(data.userid, data.message);
        }

        if (data.pin) {
            await bot.pinChatMessage(data.userid, message?.message_id ?? 0);
        }


        if (data.deleteTimeout) {
            setTimeout(() => {
                if (message) bot.deleteMessage(data.userid, message.message_id).catch(() => { });
            }, data.deleteTimeout);
        }

        if (!data.file) return message ? message.message_id : -1;


        const buffer = Buffer.from(data.file.base64, 'base64');
        const readableStream = new stream.Readable();
        readableStream.push(buffer);
        readableStream.push(null);

        await bot.sendDocument(data.userid, readableStream, {}, {
            filename: data.file.name,
            contentType: 'application/octet-stream'
        });
        return message ? message.message_id : -1;

    },
    updateMessage: async (data: { message: string, userid: number, messageid: number }) => {
        bot.editMessageText(data.message, { chat_id: data.userid, message_id: data.messageid }).catch(err => { });
    },
    waitForMessage: async (data: { userid: number }): Promise<{ text?: string, imageURL?: string }> => {
        return new Promise<{ text?: string, imageURL?: string }>((resolve) => {
            bot.on('message', async (msg) => {
                if (msg.chat.id === data.userid && msg.text) {
                    resolve({ text: msg.text });
                }
                if (msg.chat.id === data.userid && msg.photo) {
                    resolve({ imageURL: await bot.getFileLink(msg.photo[msg.photo.length - 1].file_id) });
                }
            });
        });
    },
    deleteMessage: async (data: { messageid: number, userid: number }) => {
        bot.deleteMessage(data.userid, data.messageid).catch(() => { });
    }
})
