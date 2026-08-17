import { bindEndpoint } from '$lib/server/bind';
import * as h from './handlers';

export const POST = bindEndpoint(h.POST);
