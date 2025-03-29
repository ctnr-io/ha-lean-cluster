import { z } from "zod";
import { trpc } from "../trpc.ts";
import * as contabo from '../../core/node-provisioners/contabo.ts';
import { randomUUID } from "node:crypto";
import { NodeRoles } from "../../helpers.ts";

export const getNode = trpc.procedure.input(z.object({
	id: z.string(),
})).query(async ({ input }) => {
	try {
		console.log(`Getting node ${input.id}`);
		return {
			success: true,
			message: `Successfully got node ${input.id}`,
			data: await contabo.getInstance(input.id),
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to get node: ${errorMessage}`);
		return {
			success: false,
			message: `Failed to get node: ${errorMessage}`,
		};
	}
});

export const listNodes = trpc.procedure.input(z.object({
	role: z.enum(NodeRoles).optional().default("worker"),
})).query(async ({ input }) => {
	try {
		console.log(`Listing nodes`);
		return {
			success: true,
			message: `Successfully listed nodes`,
			data: await contabo.listInstances(),
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to list nodes: ${errorMessage}`);
		return {
			success: false,
			message: `Failed to list nodes: ${errorMessage}`,
		};
	}
});

export const createNode = trpc.procedure.input(z.object({
	id: z.string(),
	role: z.enum(NodeRoles).optional().default("worker"),
})).mutation(async ({ input }) => {
	try {
		console.log(`Creating node ${input.id}`);

		await contabo.provisionInstance()

		return {
			success: true,
			message: `Successfully created node ${input.id}`,
		};	
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to create node: ${errorMessage}`);
		return {
			success: false,
			message: `Failed to create node: ${errorMessage}`,
		};
	}
})

export const deleteNode = trpc.procedure.input(z.object({
	id: z.string(),
	role: z.enum(NodeRoles).optional().default("worker"),
})).mutation(async ({ input }) => {
	try {
		console.log(`Deleting node ${input.id}`);

		await contabo.deleteInstance(input.id);

		return {
			success: true,
			message: `Successfully deleted node ${input.id}`,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to delete node: ${errorMessage}`);
		return {
			success: false,
			message: `Failed to delete node: ${errorMessage}`,
		};
	}
});

export const updateNode = trpc.procedure.input(z.object({
	id: z.string(),
})).mutation(async ({ input }) => {
	try {
		console.log(`Updating node ${input.id}`);
		return {
			success: true,
			message: `Successfully updated node ${input.id}`,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to update node: ${errorMessage}`);
		return {
			success: false,
			message: `Failed to update node: ${errorMessage}`,
		};
	}
});
