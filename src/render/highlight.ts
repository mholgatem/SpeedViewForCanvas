import hljs from 'highlight.js/lib/core';
import arduino from 'highlight.js/lib/languages/arduino';
import armasm from 'highlight.js/lib/languages/armasm';
import avrasm from 'highlight.js/lib/languages/avrasm';
import awk from 'highlight.js/lib/languages/awk';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import delphi from 'highlight.js/lib/languages/delphi';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import fortran from 'highlight.js/lib/languages/fortran';
import fsharp from 'highlight.js/lib/languages/fsharp';
import glsl from 'highlight.js/lib/languages/glsl';
import go from 'highlight.js/lib/languages/go';
import gradle from 'highlight.js/lib/languages/gradle';
import graphql from 'highlight.js/lib/languages/graphql';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import julia from 'highlight.js/lib/languages/julia';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import less from 'highlight.js/lib/languages/less';
import lisp from 'highlight.js/lib/languages/lisp';
import llvm from 'highlight.js/lib/languages/llvm';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import mipsasm from 'highlight.js/lib/languages/mipsasm';
import ocaml from 'highlight.js/lib/languages/ocaml';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import prolog from 'highlight.js/lib/languages/prolog';
import properties from 'highlight.js/lib/languages/properties';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scheme from 'highlight.js/lib/languages/scheme';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import tcl from 'highlight.js/lib/languages/tcl';
import typescript from 'highlight.js/lib/languages/typescript';
import verilog from 'highlight.js/lib/languages/verilog';
import vhdl from 'highlight.js/lib/languages/vhdl';
import x86asm from 'highlight.js/lib/languages/x86asm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { AUTO_SUBSETS } from './detect';

const LANGUAGES = {
  arduino, armasm, avrasm, awk, bash, c, clojure, cmake, cpp, csharp, css, dart, delphi, diff, dockerfile,
  dos, elixir, erlang, fortran, fsharp, glsl, go, gradle, graphql, groovy, haskell, ini, java, javascript,
  json, julia, kotlin, latex, less, lisp, llvm, lua, makefile, markdown, matlab, mipsasm, ocaml, perl, php,
  plaintext, powershell, prolog, properties, protobuf, python, r, ruby, rust, scala, scheme, scss, sql,
  swift, tcl, typescript, verilog, vhdl, x86asm, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

/** Auto-detection is slow on big inputs, so only sample the start of the file. */
const AUTO_SAMPLE_CHARS = 64 * 1024;

export function languageNames(): string[] {
  return Object.keys(LANGUAGES).sort();
}

export interface Highlighted {
  /** One HTML string per source line; every string has balanced tags. */
  lines: string[];
  language: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Split highlight.js output into lines. Spans can cross newlines (block comments,
 * strings), so open spans are closed at each line end and reopened on the next line.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      open.push(m[1]);
      current += m[1];
    } else if (m[2]) {
      open.pop();
      current += m[2];
    } else if (m[3]) {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else {
      current += m[4];
    }
  }
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
}

/** Highlight `text`. `language` may be a highlight.js name or an AUTO_SUBSETS key. */
export function highlight(text: string, language: string, enabled = true): Highlighted {
  // A final newline ends the last line; it doesn't start a new empty one.
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!enabled || language === 'plaintext') {
    return { lines: normalized.split('\n').map(escapeHtml), language: 'plaintext' };
  }
  let resolved = language;
  const subset = AUTO_SUBSETS[language];
  if (subset) {
    const guess = hljs.highlightAuto(normalized.slice(0, AUTO_SAMPLE_CHARS), subset);
    resolved = guess.relevance >= 5 && guess.language ? guess.language : 'plaintext';
  }
  if (!hljs.getLanguage(resolved)) resolved = 'plaintext';
  const { value } = hljs.highlight(normalized, { language: resolved, ignoreIllegals: true });
  return { lines: splitHighlightedLines(value), language: resolved };
}
