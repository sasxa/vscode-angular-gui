"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const core_1 = require("@angular-devkit/core");
const schematics_1 = require("@angular-devkit/schematics");
require("rxjs/add/operator/merge");
const ts = require("typescript");
const ast_utils_1 = require("../utility/ast-utils");
const config_1 = require("../utility/config");
const ng_ast_utils_1 = require("../utility/ng-ast-utils");
const route_utils_1 = require("../utility/route-utils");
// Helper functions. (possible refactors to utils)
function getSourceFile(host, path) {
    const buffer = host.read(path);
    if (!buffer) {
        throw new schematics_1.SchematicsException(`Could not find bootstrapped module.`);
    }
    const content = buffer.toString();
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    return source;
}
function getServerModulePath(host, app) {
    const mainPath = `/${app.root}/${app.main}`;
    const mainSource = getSourceFile(host, mainPath);
    const allNodes = ast_utils_1.getSourceNodes(mainSource);
    const expNode = allNodes.filter(node => node.kind === ts.SyntaxKind.ExportDeclaration)[0];
    if (!expNode) {
        return null;
    }
    const relativePath = expNode.moduleSpecifier;
    const modulePath = core_1.normalize(`/${app.root}/${relativePath.text}.ts`);
    return modulePath;
}
// end helper functions.
function addUniversalApp(options) {
    return (host, context) => {
        // Copy options.
        const universalOptions = Object.assign({}, options, { name: options.universalApp });
        // Delete non-universal options.
        delete universalOptions.universalApp;
        delete universalOptions.route;
        return schematics_1.schematic('universal', universalOptions)(host, context);
    };
}
function addAppShellConfig(options) {
    return (host) => {
        const config = config_1.getConfig(host);
        const app = config_1.getAppFromConfig(config, options.clientApp || '0');
        if (!app) {
            throw new schematics_1.SchematicsException(`Client app (${options.clientApp}) could not be found.`);
        }
        if (!options.route) {
            throw new schematics_1.SchematicsException(`Route is not defined`);
        }
        app.appShell = {
            app: options.universalApp,
            route: options.route,
        };
        host.overwrite('/.angular-cli.json', JSON.stringify(config, null, 2));
        return host;
    };
}
function addRouterModule(options) {
    return (host) => {
        const config = config_1.getConfig(host);
        const app = config_1.getAppFromConfig(config, options.clientApp || '0');
        if (app === null) {
            throw new schematics_1.SchematicsException('Client app not found.');
        }
        const modulePath = ng_ast_utils_1.getAppModulePath(host, app);
        const moduleSource = getSourceFile(host, modulePath);
        const changes = ast_utils_1.addImportToModule(moduleSource, modulePath, 'RouterModule', '@angular/router');
        const recorder = host.beginUpdate(modulePath);
        changes.forEach((change) => {
            recorder.insertLeft(change.pos, change.toAdd);
        });
        host.commitUpdate(recorder);
        return host;
    };
}
function getMetadataProperty(metadata, propertyName) {
    const properties = metadata.properties;
    const property = properties
        .filter(prop => prop.kind === ts.SyntaxKind.PropertyAssignment)
        .filter((prop) => {
        const name = prop.name;
        switch (name.kind) {
            case ts.SyntaxKind.Identifier:
                return name.getText() === propertyName;
            case ts.SyntaxKind.StringLiteral:
                return name.text === propertyName;
        }
        return false;
    })[0];
    return property;
}
function addRouterOutlet(options) {
    return (host) => {
        const routerOutletMarkup = `<router-outlet></router-outlet>`;
        const config = config_1.getConfig(host);
        const app = config_1.getAppFromConfig(config, options.clientApp || '0');
        if (app === null) {
            throw new schematics_1.SchematicsException('Client app not found.');
        }
        const modulePath = ng_ast_utils_1.getAppModulePath(host, app);
        // const modulePath = getAppModulePath(host, options);
        const moduleSource = getSourceFile(host, modulePath);
        const metadataNode = ast_utils_1.getDecoratorMetadata(moduleSource, 'NgModule', '@angular/core')[0];
        const bootstrapProperty = getMetadataProperty(metadataNode, 'bootstrap');
        const arrLiteral = bootstrapProperty
            .initializer;
        const componentSymbol = arrLiteral.elements[0].getText();
        const relativePath = ast_utils_1.getSourceNodes(moduleSource)
            .filter(node => node.kind === ts.SyntaxKind.ImportDeclaration)
            .filter(imp => {
            return ast_utils_1.findNode(imp, ts.SyntaxKind.Identifier, componentSymbol);
        })
            .map((imp) => {
            const pathStringLiteral = imp.moduleSpecifier;
            return pathStringLiteral.text;
        })[0];
        const dirEntry = host.getDir(modulePath);
        const dir = dirEntry.parent ? dirEntry.parent.path : '/';
        const compPath = core_1.normalize(`/${dir}/${relativePath}.ts`);
        const compSource = getSourceFile(host, compPath);
        const compMetadata = ast_utils_1.getDecoratorMetadata(compSource, 'Component', '@angular/core')[0];
        const templateProp = getMetadataProperty(compMetadata, 'template');
        const templateUrlProp = getMetadataProperty(compMetadata, 'templateUrl');
        if (templateProp) {
            if (!/<router\-outlet>/.test(templateProp.initializer.getText())) {
                const recorder = host.beginUpdate(compPath);
                recorder.insertRight(templateProp.initializer.getEnd() - 1, routerOutletMarkup);
                host.commitUpdate(recorder);
            }
        }
        else {
            const templateUrl = templateUrlProp.initializer.text;
            const dirEntry = host.getDir(compPath);
            const dir = dirEntry.parent ? dirEntry.parent.path : '/';
            const templatePath = core_1.normalize(`/${dir}/${templateUrl}`);
            const buffer = host.read(templatePath);
            if (buffer) {
                const content = buffer.toString();
                if (!/<router\-outlet>/.test(content)) {
                    const recorder = host.beginUpdate(templatePath);
                    recorder.insertRight(buffer.length, routerOutletMarkup);
                    host.commitUpdate(recorder);
                }
            }
        }
        return host;
    };
}
function addServerRoutes(options) {
    return (host) => {
        const config = config_1.getConfig(host);
        const app = config_1.getAppFromConfig(config, options.universalApp);
        if (app === null) {
            throw new schematics_1.SchematicsException('Universal/server app not found.');
        }
        const modulePath = getServerModulePath(host, app);
        if (modulePath === null) {
            throw new schematics_1.SchematicsException('Universal/server app not found.');
        }
        let moduleSource = getSourceFile(host, modulePath);
        if (!ast_utils_1.isImported(moduleSource, 'Routes', '@angular/router')) {
            const recorder = host.beginUpdate(modulePath);
            const routesChange = route_utils_1.insertImport(moduleSource, modulePath, 'Routes', '@angular/router');
            if (routesChange.toAdd) {
                recorder.insertLeft(routesChange.pos, routesChange.toAdd);
            }
            const imports = ast_utils_1.getSourceNodes(moduleSource)
                .filter(node => node.kind === ts.SyntaxKind.ImportDeclaration)
                .sort((a, b) => a.getStart() - b.getStart());
            const insertPosition = imports[imports.length - 1].getEnd();
            const routeText = `\n\nconst routes: Routes = [ { path: '${options.route}', component: AppShellComponent }];`;
            recorder.insertRight(insertPosition, routeText);
            host.commitUpdate(recorder);
        }
        moduleSource = getSourceFile(host, modulePath);
        if (!ast_utils_1.isImported(moduleSource, 'RouterModule', '@angular/router')) {
            const recorder = host.beginUpdate(modulePath);
            const routerModuleChange = route_utils_1.insertImport(moduleSource, modulePath, 'RouterModule', '@angular/router');
            if (routerModuleChange.toAdd) {
                recorder.insertLeft(routerModuleChange.pos, routerModuleChange.toAdd);
            }
            const metadataChange = ast_utils_1.addSymbolToNgModuleMetadata(moduleSource, modulePath, 'imports', 'RouterModule.forRoot(routes)');
            if (metadataChange) {
                metadataChange.forEach((change) => {
                    recorder.insertRight(change.pos, change.toAdd);
                });
            }
            host.commitUpdate(recorder);
        }
        return host;
    };
}
function addShellComponent(options) {
    return (host, context) => {
        const componentOptions = {
            name: 'app-shell',
            module: options.rootModuleFileName,
        };
        return schematics_1.schematic('component', componentOptions)(host, context);
    };
}
function default_1(options) {
    return schematics_1.chain([
        addUniversalApp(options),
        addAppShellConfig(options),
        addRouterModule(options),
        addRouterOutlet(options),
        addServerRoutes(options),
        addShellComponent(options),
    ]);
}
exports.default = default_1;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiL1VzZXJzL2hhbnNsL1NvdXJjZXMvaGFuc2wvZGV2a2l0LyIsInNvdXJjZXMiOlsicGFja2FnZXMvc2NoZW1hdGljcy9hbmd1bGFyL2FwcC1zaGVsbC9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFpRDtBQUNqRCwyREFPb0M7QUFDcEMsbUNBQWlDO0FBQ2pDLGlDQUFpQztBQUNqQyxvREFPOEI7QUFFOUIsOENBQTJFO0FBQzNFLDBEQUEyRDtBQUMzRCx3REFBc0Q7QUFJdEQsa0RBQWtEO0FBQ2xELHVCQUF1QixJQUFVLEVBQUUsSUFBWTtJQUM3QyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9CLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNaLE1BQU0sSUFBSSxnQ0FBbUIsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7SUFDRCxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDbEMsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsRUFBRSxDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFFaEYsTUFBTSxDQUFDLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBRUQsNkJBQTZCLElBQVUsRUFBRSxHQUFjO0lBQ3JELE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLElBQUksSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDNUMsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztJQUNqRCxNQUFNLFFBQVEsR0FBRywwQkFBYyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzVDLE1BQU0sT0FBTyxHQUFHLFFBQVEs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QUFDO2dCQUNqRCxDQUFDLENBQUMsQ0FBQztZQUNMLENBQUM7WUFDRCxJQUFJLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzlCLENBQUM7UUFHRCxNQUFNLENBQUMsSUFBSSxDQUFDO0lBQ2QsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUVELDJCQUEyQixPQUF3QjtJQUNqRCxNQUFNLENBQUMsQ0FBQyxJQUFVLEVBQUUsT0FBeUI7UUFFM0MsTUFBTSxnQkFBZ0IsR0FBRztZQUN2QixJQUFJLEVBQUUsV0FBVztZQUNqQixNQUFNLEVBQUUsT0FBTyxDQUFDLGtCQUFrQjtTQUNuQyxDQUFDO1FBRUYsTUFBTSxDQUFDLHNCQUFTLENBQUMsV0FBVyxFQUFFLGdCQUFnQixDQUFDLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ2pFLENBQUMsQ0FBQztBQUNKLENBQUM7QUFFRCxtQkFBeUIsT0FBd0I7SUFDL0MsTUFBTSxDQUFDLGtCQUFLLENBQUM7UUFDWCxlQUFlLENBQUMsT0FBTyxDQUFDO1FBQ3hCLGlCQUFpQixDQUFDLE9BQU8sQ0FBQztRQUMxQixlQUFlLENBQUMsT0FBTyxDQUFDO1FBQ3hCLGVBQWUsQ0FBQyxPQUFPLENBQUM7UUFDeEIsZUFBZSxDQUFDLE9BQU8sQ0FBQztRQUN4QixpQkFBaUIsQ0FBQyxPQUFPLENBQUM7S0FDM0IsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQVRELDRCQVNDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHsgbm9ybWFsaXplIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHtcbiAgUnVsZSxcbiAgU2NoZW1hdGljQ29udGV4dCxcbiAgU2NoZW1hdGljc0V4Y2VwdGlvbixcbiAgVHJlZSxcbiAgY2hhaW4sXG4gIHNjaGVtYXRpYyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L3NjaGVtYXRpY3MnO1xuaW1wb3J0ICdyeGpzL2FkZC9vcGVyYXRvci9tZXJnZSc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7XG4gIGFkZEltcG9ydFRvTW9kdWxlLFxuICBhZGRTeW1ib2xUb05nTW9kdWxlTWV0YWRhdGEsXG4gIGZpbmROb2RlLFxuICBnZXREZWNvcmF0b3JNZXRhZGF0YSxcbiAgZ2V0U291cmNlTm9kZXMsXG4gIGlzSW1wb3J0ZWQsXG59IGZyb20gJy4uL3V0aWxpdHkvYXN0LXV0aWxzJztcbmltcG9ydCB7IEluc2VydENoYW5nZSB9IGZyb20gJy4uL3V0aWxpdHkvY2hhbmdlJztcbmltcG9ydCB7IEFwcENvbmZpZywgZ2V0QXBwRnJvbUNvbmZpZywgZ2V0Q29uZmlnIH0gZnJvbSAnLi4vdXRpbGl0eS9jb25maWcnO1xuaW1wb3J0IHsgZ2V0QXBwTW9kdWxlUGF0aCB9IGZyb20gJy4uL3V0aWxpdHkvbmctYXN0LXV0aWxzJztcbmltcG9ydCB7IGluc2VydEltcG9ydCB9IGZyb20gJy4uL3V0aWxpdHkvcm91dGUtdXRpbHMnO1xuaW1wb3J0IHsgU2NoZW1hIGFzIEFwcFNoZWxsT3B0aW9ucyB9IGZyb20gJy4vc2NoZW1hJztcblxuXG4vLyBIZWxwZXIgZnVuY3Rpb25zLiAocG9zc2libGUgcmVmYWN0b3JzIHRvIHV0aWxzKVxuZnVuY3Rpb24gZ2V0U291cmNlRmlsZShob3N0OiBUcmVlLCBwYXRoOiBzdHJpbmcpOiB0cy5Tb3VyY2VGaWxlIHtcbiAgY29uc3QgYnVmZmVyID0gaG9zdC5yZWFkKHBhdGgpO1xuICBpZiAoIWJ1ZmZlcikge1xuICAgIHRocm93IG5ldyBTY2hlbWF0aWNzRXhjZXB0aW9uKGBDb3VsZCBub3QgZmluZCBib290c3RyYXBwZWQgbW9kdWxlLmApO1xuICB9XG4gIGNvbnN0IGNvbnRlbnQgPSBidWZmZXIudG9TdHJpbmcoKTtcbiAgY29uc3Qgc291cmNlID0gdHMuY3JlYXRlU291cmNlRmlsZShwYXRoLCBjb250ZW50LCB0cy5TY3JpcHRUYXJnZXQuTGF0ZXN0LCB0cnVlKTtcblxuICByZXR1cm4gc291cmNlO1xufVxuXG5mdW5jdGlvbiBnZXRTZXJ2ZXJNb2R1bGVQYXRoKGhvc3Q6IFRyZWUsIGFwcDogQXBwQ29uZmlnKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IG1haW5QYXRoID0gYC8ke2FwcC5yb290fS8ke2FwcC5tYWlufWA7XG4gIGNvbnN0IG1haW5Tb3VyY2UgPSBnZXRTb3VyY2VGaWxlKGhvc3QsIG1haW5QYXRoKTtcbiAgY29uc3QgYWxsTm9kZXMgPSBnZXRTb3VyY2VOb2RlcyhtYWluU291cmNlKTtcbiAgY29uc3QgZXhwTm9kZSA9IGFsbE5vZGVzLmZpbHRlcihub2RlID0+IG5vZGUua2luZCA9PT0gdHMuU3ludGF4S2luZC5FeHBvcnREZWNsYXJhdGlvbilbMF07XG4gIGlmICghZXhwTm9kZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGNvbnN0IHJlbGF0aXZlUGF0aCA9IDx0cy5TdHJpbmdMaXRlcmFsPiAoPHRzLkV4cG9ydERlY2xhcmF0aW9uPiBleHBOb2RlKS5tb2R1bGVTcGVjaWZpZXI7XG4gIGNvbnN0IG1vZHVsZVBhdGggPSBub3JtYWxpemUoYC8ke2FwcC5yb290fS8ke3JlbGF0aXZlUGF0aC50ZXh0fS50c2ApO1xuXG4gIHJldHVybiBtb2R1bGVQYXRoO1xufVxuLy8gZW5kIGhlbHBlciBmdW5jdGlvbnMuXG5cbmZ1bmN0aW9uIGFkZFVuaXZlcnNhbEFwcChvcHRpb25zOiBBcHBTaGVsbE9wdGlvbnMpOiBSdWxlIHtcbiAgcmV0dXJuIChob3N0OiBUcmVlLCBjb250ZXh0OiBTY2hlbWF0aWNDb250ZXh0KSA9PiB7XG4gICAgLy8gQ29weSBvcHRpb25zLlxuICAgIGNvbnN0IHVuaXZlcnNhbE9wdGlvbnMgPSB7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgbmFtZTogb3B0aW9ucy51bml2ZXJzYWxBcHAsXG4gICAgfTtcblxuICAgIC8vIERlbGV0ZSBub24tdW5pdmVyc2FsIG9wdGlvbnMuXG4gICAgZGVsZXRlIHVuaXZlcnNhbE9wdGlvbnMudW5pdmVyc2FsQXBwO1xuICAgIGRlbGV0ZSB1bml2ZXJzYWxPcHRpb25zLnJvdXRlO1xuXG4gICAgcmV0dXJuIHNjaGVtYXRpYygndW5pdmVyc2FsJywgdW5pdmVyc2FsT3B0aW9ucykoaG9zdCwgY29udGV4dCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGFkZEFwcFNoZWxsQ29uZmlnKG9wdGlvbnM6IEFwcFNoZWxsT3B0aW9ucyk6IFJ1bGUge1xuICByZXR1cm4gKGhvc3Q6IFRyZWUpID0+IHtcbiAgICBjb25zdCBjb25maWcgPSBnZXRDb25maWcoaG9zdCk7XG4gICAgY29uc3QgYXBwID0gZ2V0QXBwRnJvbUNvbmZpZyhjb25maWcsIG9wdGlvbnMuY2xpZW50QXBwIHx8ICcwJyk7XG5cbiAgICBpZiAoIWFwcCkge1xuICAgICAgdGhyb3cgbmV3IFNjaGVtYXRpY3NFeGNlcHRpb24oYENsaWVudCBhcHAgKCR7b3B0aW9ucy5jbGllbnRBcHB9KSBjb3VsZCBub3QgYmUgZm91bmQuYCk7XG4gICAgfVxuXG4gICAgaWYgKCFvcHRpb25zLnJvdXRlKSB7XG4gICAgICB0aHJvdyBuZXcgU2NoZW1hdGljc0V4Y2VwdGlvbihgUm91dGUgaXMgbm90IGRlZmluZWRgKTtcbiAgICB9XG5cbiAgICBhcHAuYXBwU2hlbGwgPSB7XG4gICAgICBhcHA6IG9wdGlvbnMudW5pdmVyc2FsQXBwLFxuICAgICAgcm91dGU6IG9wdGlvbnMucm91dGUsXG4gICAgfTtcblxuICAgIGhvc3Qub3ZlcndyaXRlKCcvLmFuZ3VsYXItY2xpLmpzb24nLCBKU09OLnN0cmluZ2lmeShjb25maWcsIG51bGwsIDIpKTtcblxuICAgIHJldHVybiBob3N0O1xuICB9O1xufVxuXG5mdW5jdGlvbiBhZGRSb3V0ZXJNb2R1bGUob3B0aW9uczogQXBwU2hlbGxPcHRpb25zKTogUnVsZSB7XG4gIHJldHVybiAoaG9zdDogVHJlZSkgPT4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IGdldENvbmZpZyhob3N0KTtcbiAgICBjb25zdCBhcHAgPSBnZXRBcHBGcm9tQ29uZmlnKGNvbmZpZywgb3B0aW9ucy5jbGllbnRBcHAgfHwgJzAnKTtcbiAgICBpZiAoYXBwID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgU2NoZW1hdGljc0V4Y2VwdGlvbignQ2xpZW50IGFwcCBub3QgZm91bmQuJyk7XG4gICAgfVxuICAgIGNvbnN0IG1vZHVsZVBhdGggPSBnZXRBcHBNb2R1bGVQYXRoKGhvc3QsIGFwcCk7XG4gICAgY29uc3QgbW9kdWxlU291cmNlID0gZ2V0U291cmNlRmlsZShob3N0LCBtb2R1bGVQYXRoKTtcbiAgICBjb25zdCBjaGFuZ2VzID0gYWRkSW1wb3J0VG9Nb2R1bGUobW9kdWxlU291cmNlLCBtb2R1bGVQYXRoLCAnUm91dGVyTW9kdWxlJywgJ0Bhbmd1bGFyL3JvdXRlcicpO1xuICAgIGNvbnN0IHJlY29yZGVyID0gaG9zdC5iZWdpblVwZGF0ZShtb2R1bGVQYXRoKTtcbiAgICBjaGFuZ2VzLmZvckVhY2goKGNoYW5nZTogSW5zZXJ0Q2hhbmdlKSA9PiB7XG4gICAgICByZWNvcmRlci5pbnNlcnRMZWZ0KGNoYW5nZS5wb3MsIGNoYW5nZS50b0FkZCk7XG4gICAgfSk7XG4gICAgaG9zdC5jb21taXRVcGRhdGUocmVjb3JkZXIpO1xuXG4gICAgcmV0dXJuIGhvc3Q7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldE1ldGFkYXRhUHJvcGVydHkobWV0YWRhdGE6IHRzLk5vZGUsIHByb3BlcnR5TmFtZTogc3RyaW5nKTogdHMuUHJvcGVydHlBc3NpZ25tZW50IHtcbiAgY29uc3QgcHJvcGVydGllcyA9IChtZXRhZGF0YSBhcyB0cy5PYmplY3RMaXRlcmFsRXhwcmVzc2lvbikucHJvcGVydGllcztcbiAgY29uc3QgcHJvcGVydHkgPSBwcm9wZXJ0aWVzXG4gICAgLmZpbHRlcihwcm9wID0+IHByb3Aua2luZCA9PT0gdHMuU3ludGF4S2luZC5Qcm9wZXJ0eUFzc2lnbm1lbnQpXG4gICAgLmZpbHRlcigocHJvcDogdHMuUHJvcGVydHlBc3NpZ25tZW50KSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gcHJvcC5uYW1lO1xuICAgICAgc3dpdGNoIChuYW1lLmtpbmQpIHtcbiAgICAgICAgY2FzZSB0cy5TeW50YXhLaW5kLklkZW50aWZpZXI6XG4gICAgICAgICAgcmV0dXJuIChuYW1lIGFzIHRzLklkZW50aWZpZXIpLmdldFRleHQoKSA9PT0gcHJvcGVydHlOYW1lO1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuU3RyaW5nTGl0ZXJhbDpcbiAgICAgICAgICByZXR1cm4gKG5hbWUgYXMgdHMuU3RyaW5nTGl0ZXJhbCkudGV4dCA9PT0gcHJvcGVydHlOYW1lO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSlbMF07XG5cbiAgcmV0dXJuIHByb3BlcnR5IGFzIHRzLlByb3BlcnR5QXNzaWdubWVudDtcbn1cblxuZnVuY3Rpb24gYWRkUm91dGVyT3V0bGV0KG9wdGlvbnM6IEFwcFNoZWxsT3B0aW9ucyk6IFJ1bGUge1xuICByZXR1cm4gKGhvc3Q6IFRyZWUpID0+IHtcbiAgICBjb25zdCByb3V0ZXJPdXRsZXRNYXJrdXAgPSBgPHJvdXRlci1vdXRsZXQ+PC9yb3V0ZXItb3V0bGV0PmA7XG5cbiAgICBjb25zdCBjb25maWcgPSBnZXRDb25maWcoaG9zdCk7XG4gICAgY29uc3QgYXBwID0gZ2V0QXBwRnJvbUNvbmZpZyhjb25maWcsIG9wdGlvbnMuY2xpZW50QXBwIHx8ICcwJyk7XG4gICAgaWYgKGFwcCA9PT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IFNjaGVtYXRpY3NFeGNlcHRpb24oJ0NsaWVudCBhcHAgbm90IGZvdW5kLicpO1xuICAgIH1cbiAgICBjb25zdCBtb2R1bGVQYXRoID0gZ2V0QXBwTW9kdWxlUGF0aChob3N0LCBhcHApO1xuICAgIC8vIGNvbnN0IG1vZHVsZVBhdGggPSBnZXRBcHBNb2R1bGVQYXRoKGhvc3QsIG9wdGlvbnMpO1xuICAgIGNvbnN0IG1vZHVsZVNvdXJjZSA9IGdldFNvdXJjZUZpbGUoaG9zdCwgbW9kdWxlUGF0aCk7XG5cbiAgICBjb25zdCBtZXRhZGF0YU5vZGUgPSBnZXREZWNvcmF0b3JNZXRhZGF0YShtb2R1bGVTb3VyY2UsICdOZ01vZHVsZScsICdAYW5ndWxhci9jb3JlJylbMF07XG4gICAgY29uc3QgYm9vdHN0cmFwUHJvcGVydHkgPSBnZXRNZXRhZGF0YVByb3BlcnR5KG1ldGFkYXRhTm9kZSwgJ2Jvb3RzdHJhcCcpO1xuXG4gICAgY29uc3QgYXJyTGl0ZXJhbCA9ICg8dHMuUHJvcGVydHlBc3NpZ25tZW50PiBib290c3RyYXBQcm9wZXJ0eSlcbiAgICAgIC5pbml0aWFsaXplciBhcyB0cy5BcnJheUxpdGVyYWxFeHByZXNzaW9uO1xuXG4gICAgY29uc3QgY29tcG9uZW50U3ltYm9sID0gYXJyTGl0ZXJhbC5lbGVtZW50c1swXS5nZXRUZXh0KCk7XG5cbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBnZXRTb3VyY2VOb2Rlcyhtb2R1bGVTb3VyY2UpXG4gICAgICAuZmlsdGVyKG5vZGUgPT4gbm9kZS5raW5kID09PSB0cy5TeW50YXhLaW5kLkltcG9ydERlY2xhcmF0aW9uKVxuICAgICAgLmZpbHRlcihpbXAgPT4ge1xuICAgICAgICByZXR1cm4gZmluZE5vZGUoaW1wLCB0cy5TeW50YXhLaW5kLklkZW50aWZpZXIsIGNvbXBvbmVudFN5bWJvbCk7XG4gICAgICB9KVxuICAgICAgLm1hcCgoaW1wOiB0cy5JbXBvcnREZWNsYXJhdGlvbikgPT4ge1xuICAgICAgICBjb25zdCBwYXRoU3RyaW5nTGl0ZXJhbCA9IDx0cy5TdHJpbmdMaXRlcmFsPiBpbXAubW9kdWxlU3BlY2lmaWVyO1xuXG4gICAgICAgIHJldHVybiBwYXRoU3RyaW5nTGl0ZXJhbC50ZXh0O1xuICAgICAgfSlbMF07XG5cbiAgICBjb25zdCBkaXJFbnRyeSA9IGhvc3QuZ2V0RGlyKG1vZHVsZVBhdGgpO1xuICAgIGNvbnN0IGRpciA9IGRpckVudHJ5LnBhcmVudCA/IGRpckVudHJ5LnBhcmVudC5wYXRoIDogJy8nO1xuICAgIGNvbnN0IGNvbXBQYXRoID0gbm9ybWFsaXplKGAvJHtkaXJ9LyR7cmVsYXRpdmVQYXRofS50c2ApO1xuXG4gICAgY29uc3QgY29tcFNvdXJjZSA9IGdldFNvdXJjZUZpbGUoaG9zdCwgY29tcFBhdGgpO1xuICAgIGNvbnN0IGNvbXBNZXRhZGF0YSA9IGdldERlY29yYXRvck1ldGFkYXRhKGNvbXBTb3VyY2UsICdDb21wb25lbnQnLCAnQGFuZ3VsYXIvY29yZScpWzBdO1xuICAgIGNvbnN0IHRlbXBsYXRlUHJvcCA9IGdldE1ldGFkYXRhUHJvcGVydHkoY29tcE1ldGFkYXRhLCAndGVtcGxhdGUnKTtcbiAgICBjb25zdCB0ZW1wbGF0ZVVybFByb3AgPSBnZXRNZXRhZGF0YVByb3BlcnR5KGNvbXBNZXRhZGF0YSwgJ3RlbXBsYXRlVXJsJyk7XG5cbiAgICBpZiAodGVtcGxhdGVQcm9wKSB7XG4gICAgICBpZiAoIS88cm91dGVyXFwtb3V0bGV0Pi8udGVzdCh0ZW1wbGF0ZVByb3AuaW5pdGlhbGl6ZXIuZ2V0VGV4dCgpKSkge1xuICAgICAgICBjb25zdCByZWNvcmRlciA9IGhvc3QuYmVnaW5VcGRhdGUoY29tcFBhdGgpO1xuICAgICAgICByZWNvcmRlci5pbnNlcnRSaWdodCh0ZW1wbGF0ZVByb3AuaW5pdGlhbGl6ZXIuZ2V0RW5kKCkgLSAxLCByb3V0ZXJPdXRsZXRNYXJrdXApO1xuICAgICAgICBob3N0LmNvbW1pdFVwZGF0ZShyZWNvcmRlcik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHRlbXBsYXRlVXJsID0gKHRlbXBsYXRlVXJsUHJvcC5pbml0aWFsaXplciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0O1xuICAgICAgY29uc3QgZGlyRW50cnkgPSBob3N0LmdldERpcihjb21wUGF0aCk7XG4gICAgICBjb25zdCBkaXIgPSBkaXJFbnRyeS5wYXJlbnQgPyBkaXJFbnRyeS5wYXJlbnQucGF0aCA6ICcvJztcbiAgICAgIGNvbnN0IHRlbXBsYXRlUGF0aCA9IG5vcm1hbGl6ZShgLyR7ZGlyfS8ke3RlbXBsYXRlVXJsfWApO1xuICAgICAgY29uc3QgYnVmZmVyID0gaG9zdC5yZWFkKHRlbXBsYXRlUGF0aCk7XG4gICAgICBpZiAoYnVmZmVyKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBidWZmZXIudG9TdHJpbmcoKTtcbiAgICAgICAgaWYgKCEvPHJvdXRlclxcLW91dGxldD4vLnRlc3QoY29udGVudCkpIHtcbiAgICAgICAgICBjb25zdCByZWNvcmRlciA9IGhvc3QuYmVnaW5VcGRhdGUodGVtcGxhdGVQYXRoKTtcbiAgICAgICAgICByZWNvcmRlci5pbnNlcnRSaWdodChidWZmZXIubGVuZ3RoLCByb3V0ZXJPdXRsZXRNYXJrdXApO1xuICAgICAgICAgIGhvc3QuY29tbWl0VXBkYXRlKHJlY29yZGVyKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBob3N0O1xuICB9O1xufVxuXG5mdW5jdGlvbiBhZGRTZXJ2ZXJSb3V0ZXMob3B0aW9uczogQXBwU2hlbGxPcHRpb25zKTogUnVsZSB7XG4gIHJldHVybiAoaG9zdDogVHJlZSkgPT4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IGdldENvbmZpZyhob3N0KTtcbiAgICBjb25zdCBhcHAgPSBnZXRBcHBGcm9tQ29uZmlnKGNvbmZpZywgb3B0aW9ucy51bml2ZXJzYWxBcHApO1xuICAgIGlmIChhcHAgPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBTY2hlbWF0aWNzRXhjZXB0aW9uKCdVbml2ZXJzYWwvc2VydmVyIGFwcCBub3QgZm91bmQuJyk7XG4gICAgfVxuICAgIGNvbnN0IG1vZHVsZVBhdGggPSBnZXRTZXJ2ZXJNb2R1bGVQYXRoKGhvc3QsIGFwcCk7XG4gICAgaWYgKG1vZHVsZVBhdGggPT09IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBTY2hlbWF0aWNzRXhjZXB0aW9uKCdVbml2ZXJzYWwvc2VydmVyIGFwcCBub3QgZm91bmQuJyk7XG4gICAgfVxuXG4gICAgbGV0IG1vZHVsZVNvdXJjZSA9IGdldFNvdXJjZUZpbGUoaG9zdCwgbW9kdWxlUGF0aCk7XG4gICAgaWYgKCFpc0ltcG9ydGVkKG1vZHVsZVNvdXJjZSwgJ1JvdXRlcycsICdAYW5ndWxhci9yb3V0ZXInKSkge1xuICAgICAgY29uc3QgcmVjb3JkZXIgPSBob3N0LmJlZ2luVXBkYXRlKG1vZHVsZVBhdGgpO1xuICAgICAgY29uc3Qgcm91dGVzQ2hhbmdlID0gaW5zZXJ0SW1wb3J0KG1vZHVsZVNvdXJjZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2R1bGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdSb3V0ZXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdAYW5ndWxhci9yb3V0ZXInKSBhcyBJbnNlcnRDaGFuZ2U7XG4gICAgICBpZiAocm91dGVzQ2hhbmdlLnRvQWRkKSB7XG4gICAgICAgIHJlY29yZGVyLmluc2VydExlZnQocm91dGVzQ2hhbmdlLnBvcywgcm91dGVzQ2hhbmdlLnRvQWRkKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW1wb3J0cyA9IGdldFNvdXJjZU5vZGVzKG1vZHVsZVNvdXJjZSlcbiAgICAgICAgLmZpbHRlcihub2RlID0+IG5vZGUua2luZCA9PT0gdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbilcbiAgICAgICAgLnNvcnQoKGEsIGIpID0+IGEuZ2V0U3RhcnQoKSAtIGIuZ2V0U3RhcnQoKSk7XG4gICAgICBjb25zdCBpbnNlcnRQb3NpdGlvbiA9IGltcG9ydHNbaW1wb3J0cy5sZW5ndGggLSAxXS5nZXRFbmQoKTtcbiAgICAgIGNvbnN0IHJvdXRlVGV4dCA9XG4gICAgICAgIGBcXG5cXG5jb25zdCByb3V0ZXM6IFJvdXRlcyA9IFsgeyBwYXRoOiAnJHtvcHRpb25zLnJvdXRlfScsIGNvbXBvbmVudDogQXBwU2hlbGxDb21wb25lbnQgfV07YDtcbiAgICAgIHJlY29yZGVyLmluc2VydFJpZ2h0KGluc2VydFBvc2l0aW9uLCByb3V0ZVRleHQpO1xuICAgICAgaG9zdC5jb21taXRVcGRhdGUocmVjb3JkZXIpO1xuICAgIH1cblxuICAgIG1vZHVsZVNvdXJjZSA9IGdldFNvdXJjZUZpbGUoaG9zdCwgbW9kdWxlUGF0aCk7XG4gICAgaWYgKCFpc0ltcG9ydGVkKG1vZHVsZVNvdXJjZSwgJ1JvdXRlck1vZHVsZScsICdAYW5ndWxhci9yb3V0ZXInKSkge1xuICAgICAgY29uc3QgcmVjb3JkZXIgPSBob3N0LmJlZ2luVXBkYXRlKG1vZHVsZVBhdGgpO1xuICAgICAgY29uc3Qgcm91dGVyTW9kdWxlQ2hhbmdlID0gaW5zZXJ0SW1wb3J0KG1vZHVsZVNvdXJjZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2R1bGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdSb3V0ZXJNb2R1bGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdAYW5ndWxhci9yb3V0ZXInKSBhcyBJbnNlcnRDaGFuZ2U7XG5cbiAgICAgIGlmIChyb3V0ZXJNb2R1bGVDaGFuZ2UudG9BZGQpIHtcbiAgICAgICAgcmVjb3JkZXIuaW5zZXJ0TGVmdChyb3V0ZXJNb2R1bGVDaGFuZ2UucG9zLCByb3V0ZXJNb2R1bGVDaGFuZ2UudG9BZGQpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtZXRhZGF0YUNoYW5nZSA9IGFkZFN5bWJvbFRvTmdNb2R1bGVNZXRhZGF0YShcbiAgICAgICAgICBtb2R1bGVTb3VyY2UsIG1vZHVsZVBhdGgsICdpbXBvcnRzJywgJ1JvdXRlck1vZHVsZS5mb3JSb290KHJvdXRlcyknKTtcbiAgICAgIGlmIChtZXRhZGF0YUNoYW5nZSkge1xuICAgICAgICBtZXRhZGF0YUNoYW5nZS5mb3JFYWNoKChjaGFuZ2U6IEluc2VydENoYW5nZSkgPT4ge1xuICAgICAgICAgIHJlY29yZGVyLmluc2VydFJpZ2h0KGNoYW5nZS5wb3MsIGNoYW5nZS50b0FkZCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaG9zdC5jb21taXRVcGRhdGUocmVjb3JkZXIpO1xuICAgIH1cblxuXG4gICAgcmV0dXJuIGhvc3Q7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGFkZFNoZWxsQ29tcG9uZW50KG9wdGlvbnM6IEFwcFNoZWxsT3B0aW9ucyk6IFJ1bGUge1xuICByZXR1cm4gKGhvc3Q6IFRyZWUsIGNvbnRleHQ6IFNjaGVtYXRpY0NvbnRleHQpID0+IHtcblxuICAgIGNvbnN0IGNvbXBvbmVudE9wdGlvbnMgPSB7XG4gICAgICBuYW1lOiAnYXBwLXNoZWxsJyxcbiAgICAgIG1vZHVsZTogb3B0aW9ucy5yb290TW9kdWxlRmlsZU5hbWUsXG4gICAgfTtcblxuICAgIHJldHVybiBzY2hlbWF0aWMoJ2NvbXBvbmVudCcsIGNvbXBvbmVudE9wdGlvbnMpKGhvc3QsIGNvbnRleHQpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiAob3B0aW9uczogQXBwU2hlbGxPcHRpb25zKTogUnVsZSB7XG4gIHJldHVybiBjaGFpbihbXG4gICAgYWRkVW5pdmVyc2FsQXBwKG9wdGlvbnMpLFxuICAgIGFkZEFwcFNoZWxsQ29uZmlnKG9wdGlvbnMpLFxuICAgIGFkZFJvdXRlck1vZHVsZShvcHRpb25zKSxcbiAgICBhZGRSb3V0ZXJPdXRsZXQob3B0aW9ucyksXG4gICAgYWRkU2VydmVyUm91dGVzKG9wdGlvbnMpLFxuICAgIGFkZFNoZWxsQ29tcG9uZW50KG9wdGlvbnMpLFxuICBdKTtcbn1cbiJdfQ==