/**
 * 每语言的 tree-sitter query 字符串集合
 *
 * 查询分两类：
 *   - symbolQuery：提取顶层符号定义（function / class / interface / type / const）
 *   - calleeQuery：在某函数 body 里提取被调用的符号（用于 call graph）
 *
 * 设计约束：
 *   - 捕获名严格按 "{kind}.name" / "{kind}.body" 约定（extractor.ts 依赖此约定）
 *   - const 与 arrow-function-as-const 分开两条 pattern，避免混淆 kind
 *   - 不同语言结构差异大，query 各写一份；extractor 按 lang 分发
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_code_index_v2.md — Phase 2
 */

/**
 * TypeScript / TSX symbol query
 *
 * 捕获：
 *   fn.name / fn.body             —— 函数声明
 *   arrowFn.name / arrowFn.body   —— const foo = () => {...}
 *   class.name / class.body       —— 类
 *   iface.name                    —— 接口
 *   type.name                     —— type alias
 *   const.name                    —— 常量（非函数）
 */
export const TS_SYMBOL_QUERY = `
  (function_declaration
    name: (identifier) @fn.name
    body: (statement_block) @fn.body)

  (lexical_declaration
    (variable_declarator
      name: (identifier) @arrowFn.name
      value: [(arrow_function) (function_expression)] @arrowFn.body))

  (class_declaration
    name: (type_identifier) @class.name
    body: (class_body) @class.body)

  (interface_declaration
    name: (type_identifier) @iface.name)

  (type_alias_declaration
    name: (type_identifier) @type.name)

  (lexical_declaration
    (variable_declarator
      name: (identifier) @const.name
      value: [(string) (number) (true) (false) (null) (object) (array) (template_string) (regex)]))
`;

/**
 * TypeScript / TSX callee query
 *
 * 捕获：
 *   callee.name  —— 普通 foo(...) 调用
 *   member.name  —— x.foo(...) 的方法名
 *   new.name     —— new Foo(...)
 */
export const TS_CALLEE_QUERY = `
  (call_expression function: (identifier) @callee.name)
  (call_expression function: (member_expression property: (property_identifier) @member.name))
  (new_expression constructor: (identifier) @new.name)
`;

/**
 * JavaScript symbol query（与 TS 基本一致，但没有 interface / type alias）
 */
export const JS_SYMBOL_QUERY = `
  (function_declaration
    name: (identifier) @fn.name
    body: (statement_block) @fn.body)

  (lexical_declaration
    (variable_declarator
      name: (identifier) @arrowFn.name
      value: [(arrow_function) (function_expression)] @arrowFn.body))

  (variable_declaration
    (variable_declarator
      name: (identifier) @arrowFn.name
      value: [(arrow_function) (function_expression)] @arrowFn.body))

  (class_declaration
    name: (identifier) @class.name
    body: (class_body) @class.body)

  (lexical_declaration
    (variable_declarator
      name: (identifier) @const.name
      value: [(string) (number) (true) (false) (null) (object) (array) (template_string) (regex)]))
`;

export const JS_CALLEE_QUERY = TS_CALLEE_QUERY;

/**
 * Python symbol query
 *
 * Python 没有 interface/type；class 算 class；function 算 function；
 * 模块顶层赋值视为 const。
 */
export const PY_SYMBOL_QUERY = `
  (function_definition
    name: (identifier) @fn.name
    body: (block) @fn.body)

  (class_definition
    name: (identifier) @class.name
    body: (block) @class.body)

  (module
    (expression_statement
      (assignment
        left: (identifier) @const.name)))
`;

/**
 * Python callee query
 *   普通 foo(...) / obj.foo(...)
 */
export const PY_CALLEE_QUERY = `
  (call function: (identifier) @callee.name)
  (call function: (attribute attribute: (identifier) @member.name))
`;

/**
 * Go symbol query
 *   func Foo / method / type / const / var
 */
export const GO_SYMBOL_QUERY = `
  (function_declaration
    name: (identifier) @fn.name
    body: (block) @fn.body)

  (method_declaration
    name: (field_identifier) @fn.name
    body: (block) @fn.body)

  (type_declaration
    (type_spec
      name: (type_identifier) @type.name))

  (const_declaration
    (const_spec
      name: (identifier) @const.name))

  (var_declaration
    (var_spec
      name: (identifier) @const.name))
`;

/**
 * Go callee query
 */
export const GO_CALLEE_QUERY = `
  (call_expression function: (identifier) @callee.name)
  (call_expression function: (selector_expression field: (field_identifier) @member.name))
`;

/**
 * Rust symbol query
 *   fn / struct / enum / trait / type alias / const / static
 */
export const RUST_SYMBOL_QUERY = `
  (function_item
    name: (identifier) @fn.name
    body: (block) @fn.body)

  (struct_item
    name: (type_identifier) @class.name)

  (enum_item
    name: (type_identifier) @class.name)

  (trait_item
    name: (type_identifier) @iface.name)

  (type_item
    name: (type_identifier) @type.name)

  (const_item
    name: (identifier) @const.name)

  (static_item
    name: (identifier) @const.name)
`;

/**
 * Rust callee query
 */
export const RUST_CALLEE_QUERY = `
  (call_expression function: (identifier) @callee.name)
  (call_expression function: (field_expression field: (field_identifier) @member.name))
  (call_expression function: (scoped_identifier name: (identifier) @callee.name))
`;
