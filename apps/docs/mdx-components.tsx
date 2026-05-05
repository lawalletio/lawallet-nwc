import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import {
  SandpackExample,
  SandpackLive,
  SandpackCodeOnly,
} from '@/components/sandpack-wrapper';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    SandpackExample,
    SandpackLive,
    SandpackCodeOnly,
    ...components,
  };
}
