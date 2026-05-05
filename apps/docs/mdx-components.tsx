import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import {
  SandpackExample,
  SandpackLive,
  SandpackCodeOnly,
} from '@/components/sandpack-wrapper';
import { ApiReference } from '@/components/api-reference';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    SandpackExample,
    SandpackLive,
    SandpackCodeOnly,
    ApiReference,
    ...components,
  };
}
