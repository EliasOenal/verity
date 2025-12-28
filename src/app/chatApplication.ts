import { Buffer } from 'buffer';
import { Cube } from '../cci/cube/cube';
import { VerityField } from '../cci/cube/verityField';
import { FieldType } from '../cci/cube/cube.definitions';
import { CubeType, NotificationKey } from '../core/cube/coreCube.definitions';
import { CubeField } from '../core/cube/cubeField';
import { logger } from '../core/logger';
import { CoreCube } from '../core/cube/coreCube';

export class ChatApplication {
    private static readonly APPLICATION_IDENTIFIER = 'chat';

    /**
     * Creates a chat cube from a username, message, and notification key.
     * @param username The username of the message sender.
     * @param message The chat message content.
     * @param notificationKey A 32-byte Buffer representing the notification key.
     * @returns A frozen notify cciCube containing the chat message.
     * @throws Error if the notification key is invalid.
     */
    static async createChatCube(username: string, message: string, notificationKey: NotificationKey): Promise<Cube> {
        if (!Buffer.isBuffer(notificationKey) || notificationKey.length !== 32) {
            throw new Error('Invalid notification key: must be a 32-byte Buffer');
        }

        const cube: CoreCube = Cube.Frozen({
            fields: [
                VerityField.Notify(notificationKey),
                VerityField.Application(this.APPLICATION_IDENTIFIER),
                VerityField.Username(username),
                VerityField.Payload(Buffer.from(message, 'utf-8')),
            ],
        });

        return cube as Cube;
    }

    /**
     * Parses a chat cube and extracts the username, message, and notification key.
     * @param cube The chat cube to parse.
     * @returns An object containing the username, message, and notification key.
     * @throws Error if the cube is not a valid chat cube or if required fields are missing.
     */
    static parseChatCube(cube: Cube): { username: string, message: string, notificationKey: Buffer } {
        if (cube.cubeType !== CubeType.FROZEN_NOTIFY) {
            throw new Error('Chat application requires frozen notify cubes, passed cube is: ' + cube.cubeType);
        }

        const applicationFields = cube.fields.get(FieldType.APPLICATION);
        if (!applicationFields || !applicationFields.some(field => field.valueString === this.APPLICATION_IDENTIFIER)) {
            throw new Error('Not a chat application cube');
        }

        const usernameFields = cube.fields.get(FieldType.USERNAME);
        if (!usernameFields || usernameFields.length === 0) {
            throw new Error('Username not found in chat cube');
        }
        const username = usernameFields[0].valueString;

        const payloadFields = cube.fields.get(FieldType.PAYLOAD);
        if (!payloadFields || payloadFields.length === 0) {
            throw new Error('Message payload not found in chat cube');
        }
        const message = payloadFields[0].value.toString('utf-8');

        const notifyFields = cube.fields.get(FieldType.NOTIFY);
        if (!notifyFields || notifyFields.length === 0) {
            throw new Error('Notification key not found in chat cube');
        }
        const notificationKey = notifyFields[0].value;

        if (!Buffer.isBuffer(notificationKey) || notificationKey.length !== 32) {
            throw new Error('Invalid notification key in chat cube');
        }

        return { username, message, notificationKey };
    }
}
