import { Buffer } from "buffer";
import { Cube } from "../../../src/cci/cube/cube";
import { VerityField } from "../../../src/cci/cube/verityField";
import { FieldType } from "../../../src/cci/cube/cube.definitions";
import {
  CubeType,
  NotificationKey,
} from "../../../src/core/cube/coreCube.definitions";
import { CoreCube } from "../../../src/core/cube/coreCube";

const APPLICATION_IDENTIFIER = "chat";

// createChatCube constructs an immutable (Frozen) notification cube. Field choices:
// - Notify: allows subscription & indexed retrieval by the 32‑byte notificationKey (room id)
// - Application: tags cube with logical app name so unrelated apps can ignore it quickly
// - Username: who sent the message (not authenticated here; could instead embed identity cube ref)
// - Payload: UTF‑8 body
// NOTE: Could be extended with additional fields (e.g. signature, room meta).
export async function createChatCube(
  username: string,
  message: string,
  notificationKey: NotificationKey
): Promise<Cube> {
  if (!Buffer.isBuffer(notificationKey) || notificationKey.length !== 32) {
    throw new Error("Invalid notification key: must be 32 bytes");
  }
  const cube: CoreCube = Cube.Frozen({
    fields: [
      VerityField.Notify(notificationKey),
      VerityField.Application(APPLICATION_IDENTIFIER),
      VerityField.Username(username),
      VerityField.Payload(Buffer.from(message, "utf-8")),
    ],
  });
  return cube as Cube;
}

// parseChatCube validates structure & extracts fields. Defensive checks reject non‑chat cubes early.
export function parseChatCube(cube: Cube): {
  username: string;
  message: string;
  notificationKey: Buffer;
} {
  if (cube.cubeType !== CubeType.FROZEN_NOTIFY) {
    throw new Error("Chat cube must be FROZEN_NOTIFY, got: " + cube.cubeType);
  }
  const appFields = cube.fields.get(FieldType.APPLICATION);
  if (
    !appFields ||
    !appFields.some((f) => f.valueString === APPLICATION_IDENTIFIER)
  ) {
    throw new Error("Not a chat application cube");
  }
  const usernameFields = cube.fields.get(FieldType.USERNAME);
  if (!usernameFields || !usernameFields.length)
    throw new Error("Username missing");
  const payloadFields = cube.fields.get(FieldType.PAYLOAD);
  if (!payloadFields || !payloadFields.length)
    throw new Error("Message payload missing");
  const notifyFields = cube.fields.get(FieldType.NOTIFY);
  if (!notifyFields || !notifyFields.length)
    throw new Error("Notification key missing");
  const notificationKey = notifyFields[0].value;
  if (!Buffer.isBuffer(notificationKey) || notificationKey.length !== 32)
    throw new Error("Invalid notification key size");
  return {
    username: usernameFields[0].valueString,
    message: payloadFields[0].value.toString("utf-8"),
    notificationKey,
  };
}
