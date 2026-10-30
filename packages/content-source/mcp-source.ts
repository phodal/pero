import {z} from 'zod';
/** Config holds environment references; resolved credentials never enter a View. */
export const McpServerConfigSchema=z.discriminatedUnion('transport',[
  z.object({id:z.string().min(1).max(128),title:z.string().min(1).max(256),transport:z.literal('http'),url:z.url().refine(value=>['http:','https:'].includes(new URL(value).protocol)),header_env:z.record(z.string(),z.string()).default({})}).strict(),
  z.object({id:z.string().min(1).max(128),title:z.string().min(1).max(256),transport:z.literal('stdio'),command:z.string().min(1),args:z.array(z.string()).default([]),env:z.record(z.string(),z.string()).default({})}).strict(),
]);
export type McpServerConfig=z.infer<typeof McpServerConfigSchema>;
export type {McpAppBinding} from '../../protocol/generated/host';
const args=z.record(z.string(),z.unknown());
export const McpPanelCommandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('list')}).strict(),
  z.object({action:z.literal('configure'),config:McpServerConfigSchema}).strict(),
  z.object({action:z.literal('connect'),server:z.string()}).strict(),
  z.object({action:z.literal('disconnect'),server:z.string()}).strict(),
  z.object({action:z.literal('execute'),server:z.string(),thread_id:z.string(),tool:z.string(),arguments:args}).strict(),
  z.object({action:z.literal('tool'),binding:z.string(),name:z.string(),arguments:args}).strict(),
  z.object({action:z.literal('resource'),binding:z.string(),uri:z.string()}).strict(),
  z.object({action:z.literal('close'),binding:z.string()}).strict(),
  z.object({action:z.literal('open_link'),binding:z.string(),url:z.url()}).strict(),
]);
export type McpPanelCommand=z.infer<typeof McpPanelCommandSchema>;
