import styled from 'styled-components'

// 通用胶囊标签样式，适用于 ID/状态等信息展示。
const Tag = styled.span<{ bg?: string; border?: string; color?: string }>`
  padding: 4px 10px;
  border-radius: 6px;
  background: ${({ bg }) => bg ?? '#bdbdbd17'};
  border: 1px solid ${({ border }) => border ?? 'rgba(0, 0, 0, 0.08)'};
  color: ${({ color }) => color ?? '#1f2937'};
  font-size: 12px;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`

export default Tag

