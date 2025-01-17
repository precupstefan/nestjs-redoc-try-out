import { OpenAPIObject } from '@nestjs/swagger';
import { PathItemObject, OperationObject, SecurityRequirementObject, ReferenceObject, SecuritySchemeObject, RequestBodyObject, SchemaObject, ServerObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { NoServerError, InvalidMethodError, InvalidSchemeError, InvalidPathError } from './errors';

export const VALID_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'] as const;
export type HttpMethod = typeof VALID_METHODS[number];

export interface SecurityInfo {
    requirements: string[];
    getSecurityScheme(id:string): SecuritySchemeObject;
}

export interface OperationObjectWrapper extends OperationObject {
    baseUrl: string;
    method: HttpMethod;
    pathname: string;
    requestBody?: RequestBodyObject;
    securityInfo: SecurityInfo;
    securityRequirements: string[];
}

export interface PathItemObjectWrapper extends PathItemObject {
    baseUrl: string;
    pathname: string;
    methods: OperationObjectWrapper[];
    get?: OperationObjectWrapper;
    put?: OperationObjectWrapper;
    post?: OperationObjectWrapper;
    delete?: OperationObjectWrapper;
    options?: OperationObjectWrapper;
    head?: OperationObjectWrapper;
    patch?: OperationObjectWrapper;
    trace?: OperationObjectWrapper;
}

export class OpenApiWrapper {

    #openApi: OpenAPIObject;
    #paths: Record<string, PathItemObjectWrapper> = {};

    constructor(openApi: OpenAPIObject) {
        this.#openApi = openApi;
    }

    get paths(): PathItemObjectWrapper[] {

        this.availablePaths
            .filter(pathname => !this.#paths[pathname])
            .forEach(pathname => this.getPath(pathname));

        return Object.values(this.#paths);
    }

    get availablePaths(): string[] {
        return Object.keys(this.#openApi.paths);
    }

    get security(): SecurityRequirementObject[] {
        return this.#openApi.security||[];
    }

    get securityRequirements(): string[] {
        return this.securityToStrings(this.security);
    }

    public get baseUrl(): string {
        const server = this.#openApi.servers?.find(server => !!server.url);

        if (!server) {
            let baseUrl = '';
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            if (typeof this.#openApi.schemes !== 'undefined') {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                baseUrl += this.#openApi.schemes[0];
            }
            else {
                baseUrl += 'http';
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            if (this.#openApi.basePath === '/') {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                baseUrl += '://' + this.#openApi.host;
            }
            else {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                baseUrl += '://' + this.#openApi.host + this.#openApi.basePath;
            }
            return baseUrl;
        }

        return server?.url;
    }

    private resolveScheme(resolve: SchemaObject|ReferenceObject): SchemaObject {
        if ( !resolve['$ref'] ) {
            return resolve as SchemaObject;
        }
        const schema = resolve['$ref'].split('/').reduce((previous, current) => previous === '#' ? this.#openApi[current] : previous[current]);
        return this.resolveScheme(schema);
    }

    private resolveRequestBodyReferences(requestBody: RequestBodyObject|ReferenceObject) {
        const content = (requestBody as RequestBodyObject)?.content||{};
        Object.values(content).filter(mediaType => !!mediaType['schema']).forEach(
            mediaType => mediaType['schema'] = this.resolveScheme(mediaType['schema'])
        );
        return requestBody;
    }

    private resolveBaseUrl(servers: ServerObject[], baseUrl: string): string {
        const server = servers?.find(server => !!server.url)
        return server?.url || baseUrl;
    }

    private createOperation(operation: OperationObject, methodName:string, pathname: string, parentBaseUrl: string): OperationObjectWrapper {

        if ( !operation ) {
            throw new InvalidMethodError(pathname, methodName);
        }

        const control: { [key: string]: any }  = {};

        const getBaseUrl = (servers) => control.baseUrl = control.baseUrl||this.resolveBaseUrl(servers, parentBaseUrl);
        const getRequestBody = (requestBody) => control.requestBody = control.requestBody||this.resolveRequestBodyReferences(requestBody);
        const getSecurityRequirements = (security) => control.securityRequirements = control.securityRequirements||this.securityToRequirements(security)
        const getSecurityScheme = (id: string) => this.getSecurityScheme(id);

        return {
            pathname,
            method: methodName.toUpperCase() as HttpMethod,
            tags: operation.tags||[],
            summary: operation.summary||'',
            description: operation.description||'',
            operationId: operation.operationId||'',
            parameters: operation.parameters||[],
            responses: operation.responses||{},
            deprecated: !!operation.deprecated,
            security: operation.security||[],
            servers: operation.servers||[],
            get baseUrl() { return getBaseUrl(operation.servers) },
            get securityRequirements() { return getSecurityRequirements(operation.security) },
            get requestBody() { return getRequestBody(operation.requestBody) },
            get securityInfo() { return { 
                get requirements() { return getSecurityRequirements(operation.security) },
                getSecurityScheme(id: string) { return getSecurityScheme(id) }
            }}
        }
    }

    private createPath(path: PathItemObject, pathname: string): PathItemObjectWrapper {
        
        const control: { [key: string]: any } = {};

        const getBaseUrl = (servers) => control.baseUrl = control.baseUrl||this.resolveBaseUrl(servers, this.baseUrl);
        const getOperation = (operation) => control[operation] = control[operation]||this.createOperation(path[operation], operation, pathname, pathWrapper.baseUrl);
        const getMethods = () => Object.keys(path).filter((key:HttpMethod) => VALID_METHODS.includes(key)).map(method => pathWrapper[method]);

        const pathWrapper = {
            pathname,
            summary: path.summary || '',
            description: path.description || '',
            servers: path.servers||[],
            parameters: path.parameters||[],
            get baseUrl() { return getBaseUrl(path.servers) },
            get methods() { return getMethods() } ,
            get get() { return getOperation('get') },
            get put() { return getOperation('put') },
            get post() { return getOperation('post') },
            get delete() { return getOperation('delete') },
            get options() { return getOperation('options') },
            get head() { return getOperation('head') },
            get patch() { return getOperation('patch') },
            get trace() { return getOperation('trace') },
        }

        return pathWrapper;
    }

    private securityToRequirements(security: SecurityRequirementObject[]) {
        return (security||[]).length > 0 ? this.securityToStrings(security) : this.securityRequirements;
    }

    private securityToStrings(security: SecurityRequirementObject[]): string[] {
        return security.map((securityObject:SecurityRequirementObject) => Object.keys(securityObject).find(key => !!key) || 'public');
    }

    public getSecurityScheme(id:string): SecuritySchemeObject {
        if ( !this.#openApi.components?.securitySchemes[id] ) {
            throw new InvalidSchemeError('securityScheme', id);
        }
        return this.resolveScheme(this.#openApi.components.securitySchemes[id]) as SecuritySchemeObject;
    }

    public getPath(pathname: string) {
        if( !this.availablePaths.includes(pathname) ) {
            throw new InvalidPathError(pathname);
        }

        this.#paths[pathname] = this.#paths[pathname]||this.createPath(this.#openApi.paths[pathname], pathname);
        return this.#paths[pathname];
    }
}