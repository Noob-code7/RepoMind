/**
 * context/ast_analyzer.ts
 * Deterministic AST static analysis for TypeScript & JavaScript using TypeScript Compiler API.
 * Extracts functions, classes, interfaces, types, exports, imports, and route patterns.
 */
import ts from 'typescript';
import { SymbolContext, SymbolKind } from './schemas.js';

export interface AstAnalysisResult {
  imports: string[];
  exports: string[];
  symbols: SymbolContext[];
  summary?: string;
}

export class AstAnalyzer {
  /**
   * Analyze TypeScript / JavaScript source code using the TypeScript AST parser.
   */
  static analyze(filePath: string, sourceText: string): AstAnalysisResult {
    const isTs = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
    const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      isJsx ? ts.ScriptKind.TSX : isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );

    const imports: string[] = [];
    const exports: string[] = [];
    const symbols: SymbolContext[] = [];

    function isNodeExported(node: ts.Node): boolean {
      return (
        (ts.getCombinedModifierFlags(node as ts.Declaration) &
          ts.ModifierFlags.Export) !==
          0 ||
        (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
      );
    }

    function extractDocstring(node: ts.Node): string | undefined {
      const fullText = sourceFile.getFullText();
      const commentRanges = ts.getLeadingCommentRanges(fullText, node.pos);
      if (commentRanges && commentRanges.length > 0) {
        const lastComment = commentRanges[commentRanges.length - 1];
        const comment = fullText.slice(lastComment.pos, lastComment.end).trim();
        return comment
          .replace(/\/\*\*|\*\/|\*/g, '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .join(' ');
      }
      return undefined;
    }

    function visit(node: ts.Node) {
      // 1. Imports
      if (ts.isImportDeclaration(node)) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          imports.push(node.moduleSpecifier.text);
        }
      }

      // 2. Export Declarations (e.g. export { a, b })
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            exports.push(el.name.text);
          }
        }
      }

      // 3. Function Declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        const exported = isNodeExported(node);
        if (exported) exports.push(name);

        const sig = node.getText(sourceFile).split('{')[0].trim();
        symbols.push({
          name,
          kind: 'function',
          file: filePath,
          exported,
          signature: sig,
          docstring: extractDocstring(node),
        });
      }

      // 4. Class Declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        const exported = isNodeExported(node);
        if (exported) exports.push(name);

        const isService = name.toLowerCase().endsWith('service');
        symbols.push({
          name,
          kind: isService ? 'service' : 'class',
          file: filePath,
          exported,
          signature: `class ${name}`,
          docstring: extractDocstring(node),
        });
      }

      // 5. Interface & Type Declarations
      if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        const exported = isNodeExported(node);
        if (exported) exports.push(name);

        symbols.push({
          name,
          kind: 'interface',
          file: filePath,
          exported,
          signature: `interface ${name}`,
          docstring: extractDocstring(node),
        });
      }

      if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        const exported = isNodeExported(node);
        if (exported) exports.push(name);

        symbols.push({
          name,
          kind: 'type',
          file: filePath,
          exported,
          signature: `type ${name}`,
          docstring: extractDocstring(node),
        });
      }

      // 6. Variable Declarations (const / let exports or arrow functions)
      if (ts.isVariableStatement(node)) {
        const exported = isNodeExported(node);
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            if (exported) exports.push(name);

            const isComponent = /^[A-Z]/.test(name) && isJsx;
            const kind: SymbolKind = isComponent
              ? 'component'
              : decl.initializer &&
                (ts.isArrowFunction(decl.initializer) ||
                  ts.isFunctionExpression(decl.initializer))
              ? 'function'
              : 'variable';

            symbols.push({
              name,
              kind,
              file: filePath,
              exported,
              signature: decl.getText(sourceFile).split('=>')[0].trim(),
              docstring: extractDocstring(node),
            });
          }
        }
      }

      // 7. Route Calls (e.g. app.get('/login', ...), router.post('/register', ...))
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          const method = expr.name.text.toLowerCase();
          if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
            const firstArg = node.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg)) {
              const routePath = firstArg.text;
              const routeSymbol = `${method.toUpperCase()} ${routePath}`;
              symbols.push({
                name: routeSymbol,
                kind: 'route',
                file: filePath,
                exported: true,
                signature: `${method.toUpperCase()} ${routePath}`,
              });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    const uniqueExports = Array.from(new Set(exports));
    const uniqueImports = Array.from(new Set(imports));

    return {
      imports: uniqueImports,
      exports: uniqueExports,
      symbols,
      summary: symbols.length > 0 ? `${symbols.length} symbols (${uniqueExports.length} exported)` : undefined,
    };
  }
}
