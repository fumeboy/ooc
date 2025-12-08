// Info 表格视图。
import { useAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { createColumnHelper, flexRender, getCoreRowModel, getExpandedRowModel, getGroupedRowModel, useReactTable, type ColumnPinningState, type ColumnSizingState, type GroupingState, type ExpandedState } from '@tanstack/react-table'
import { infosBySessionAtom, selectedInfoBySessionAtom, infoActiveTabBySessionAtom, infoDetailTabsBySessionAtom } from '../../atoms'
import { getInfo, listInfos } from '../../api/client'
import type { InfoListItem, InfoResponse } from '../../types/api'
import TabSwitcher from '../common/TabSwitcher'
import Tag from '../common/Tag'
import { LuSearch } from "react-icons/lu";
import { BsTable } from "react-icons/bs";
import PageLayout from '../common/PageLayout'
import LoadingSpinner from '../common/LoadingSpinner'

interface Props {
  sessionId: string
  onOpenConversation?: (conversationId: string) => void
  initialActiveTab?: string
  onActiveTabChange?: (tab: string) => void
}

export default function InfoTableTab({
  sessionId,
  onOpenConversation,
  initialActiveTab = 'index',
  onActiveTabChange,
}: Props) {
  const [infosMap, setInfosMap] = useAtom(infosBySessionAtom)
  const [selectedMap, setSelectedMap] = useAtom(selectedInfoBySessionAtom)
  const [activeTabMap, setActiveTabMap] = useAtom(infoActiveTabBySessionAtom)
  const [detailTabsMap, setDetailTabsMap] = useAtom(infoDetailTabsBySessionAtom)

  const [detailMap, setDetailMap] = useState<Record<string, InfoResponse>>({})
  const [loading, setLoading] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({})
  
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ right: ['action'] })
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({
    id: 160,
    class: 140,
    name: 200,
    description: 320,
    action: 60,
  })
  const [grouping, setGrouping] = useState<GroupingState>(['class'])
  const [expanded, setExpanded] = useState<ExpandedState>(true)
  const infos: InfoListItem[] = infosMap[sessionId] || []
  // const selectedId = selectedMap[sessionId] || null
  const activeTab = activeTabMap[sessionId] || 'index'
  const detailTabs = detailTabsMap[sessionId] || []

  const setActive = useCallback(
    (key: string) => {
      setActiveTabMap((prev) => ({ ...prev, [sessionId]: key }))
      onActiveTabChange?.(key)
    },
    [sessionId, setActiveTabMap, onActiveTabChange]
  )
  
  const setDetailTabsUpdater = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setDetailTabsMap((prev) => {
        const current = prev[sessionId] || []
        const next = updater(current)
        if (JSON.stringify(current) === JSON.stringify(next)) return prev
        return { ...prev, [sessionId]: next }
      })
    },
    [sessionId, setDetailTabsMap]
  )

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!sessionId) return
      setLoading(true)
      try {
        const res = await listInfos(sessionId)
        if (mounted) {
          setInfosMap((prev) => ({ ...prev, [sessionId]: res.infos }))
        }
      } catch (e) {
        console.error('Failed to list infos', e)
        // optionally handle 404 or other errors
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [sessionId, setInfosMap])

  const viewDetail = useCallback(async (id: string) => {
    setActive(id)
    setDetailTabsUpdater((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setSelectedMap((prev) => ({ ...prev, [sessionId]: id }))
    setLoadingDetails((prev) => ({ ...prev, [id]: true }))
    try {
      const info = await getInfo(sessionId, id, true)
      setDetailMap((prev) => ({ ...prev, [id]: info }))
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [id]: false }))
    }
  }, [sessionId, setActive, setDetailTabsUpdater, setSelectedMap])

  const closeDetailTab = useCallback((key: string) => {
    setDetailTabsUpdater((prev) => prev.filter((id) => id !== key))
    if (activeTab === key) {
      setActive('index')
    }
  }, [activeTab, setActive, setDetailTabsUpdater])

  const tabs = useMemo(() => {
    const base = [{ key: 'index', label: 'Index' }]
    const details = detailTabs.map((id) => ({
      key: id,
      label: `Info ${id.slice(-4)}`,
      closable: true,
    }))
    return [...base, ...details]
  }, [detailTabs])

  useEffect(() => {
    if (!sessionId || !initialActiveTab) return
    if (activeTab === initialActiveTab) return // Guard against infinite loop

    if (initialActiveTab === 'index') {
      setActive('index')
      return
    }
    setActive(initialActiveTab)
    setDetailTabsUpdater((prev) => (prev.includes(initialActiveTab) ? prev : [...prev, initialActiveTab]))
    viewDetail(initialActiveTab)
  }, [initialActiveTab, sessionId, setActive, setDetailTabsUpdater, viewDetail, activeTab])

  // Removed onActiveTabChange effect as it's now handled in setActive callback
  
  // Removed initialActiveTab forcing logic as it's handled above

  const palette = ['#2563eb', '#16a34a', '#f59e0b', '#f97316', '#8b5cf6', '#0ea5e9', '#14b8a6', '#ef4444']
  const classColor = useCallback((cls: string) => {
    let hash = 0
    for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) >>> 0
    const idx = hash % palette.length
    return palette[idx]
  }, [])

  const columnHelper = createColumnHelper<InfoListItem>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: (info) => <CellText maxWidth={columnSizing.id}>{info.getValue()}</CellText>,
      }),
      columnHelper.accessor('class', {
        header: 'Class',
        enableGrouping: true,
      }),
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => <CellText maxWidth={columnSizing.name}>{info.getValue()}</CellText>,
      }),
      columnHelper.accessor('description', {
        header: '描述',
        cell: (info) => <CellText maxWidth={columnSizing.description}>{info.getValue()}</CellText>,
      }),
      columnHelper.display({
        id: 'action',
        header: '',
        cell: (info) => (
          <button
            className="btn-secondary"
            style={{ padding: '6px 6px', borderRadius: '50%', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => viewDetail(info.row.original.id)}
            aria-label="查看详情"
          >
            <LuSearch size={20} />
          </button>
        ),
        meta: { pinned: true },
      }),
    ],
    [classColor, columnSizing, viewDetail]
  )

  const table = useReactTable({
    data: infos,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    state: {
      columnPinning,
      columnSizing,
      grouping,
      expanded,
    },
    onColumnPinningChange: setColumnPinning,
    onColumnSizingChange: setColumnSizing,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    enableColumnPinning: true,
    columnResizeMode: 'onChange',
  })

  const renderDetail = (id: string) => {
    const detail = detailMap[id]
    const fallbackCls = infos.find((i) => i.id === id)?.class
    const cls = detail?.class || fallbackCls || ''
    const isConversation = cls.toLowerCase().includes('conversation')
    if (loadingDetails[id]) {
      return <TabPage>加载中...</TabPage>
    }
    if (!detail) {
      return <TabPage>尚未加载详情</TabPage>
    }
    return (
      <TabPage>
        <div className="space-y-2 text-sm">
          <div className="font-semibold">{detail.name}</div>
          <div className="text-slate-500">{detail.description}</div>
          {isConversation && (
            <button
              className="btn-primary text-xs"
              style={{ width: 'fit-content', padding: '6px 12px', borderRadius: '10px' }}
              onClick={() => onOpenConversation?.(id)}
            >
              查看会话详情
            </button>
          )}
          {detail.prompt && (
            <div>
              <div className="text-xs text-slate-500">Prompt</div>
              <pre className="whitespace-pre-wrap text-xs bg-slate-100 p-2 rounded">{detail.prompt}</pre>
            </div>
          )}
          {detail.methods && (
            <div>
              <div className="text-xs text-slate-500">Methods</div>
              <ul className="list-disc pl-4 text-xs">
                {detail.methods.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-2">当前选中: {id}</div>
      </TabPage>
    )
  }

  return (
    <PageLayout
      header={
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-4 rounded-lg border border-gray-300">
              <BsTable size={18} color="green" />
              <h4 className="font-semibold">Infos</h4>
            </div>
            <LoadingSpinner loading={loading} text="加载中..." />
          </div>
          <TabSwitcher tabs={tabs} activeKey={activeTab} onChange={setActive} onClose={closeDetailTab} />
        </>
      }
    >
      {activeTab === 'index' ? (
        <TabPage className="" style={{}}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="text-left text-xs text-slate-500"
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        borderRight: '1px solid var(--border-color)',
                        padding: '6px 8px',
                        whiteSpace: 'nowrap',
                        width: `${header.getSize()}px`,
                        minWidth: `${header.getSize()}px`,
                        maxWidth: `${header.getSize()}px`,
                        position: header.column.getIsPinned() ? 'sticky' : undefined,
                        right: header.column.getIsPinned() === 'right' ? 0 : undefined,
                        left: header.column.getIsPinned() === 'left' ? 0 : undefined,
                        background: 'var(--bg-primary)',
                        zIndex: header.column.getIsPinned() ? 2 : 1,
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                if (row.getIsGrouped()) {
                  return (
                    <tr key={row.id} style={{ background: '#f9fafb' }}>
                      <td colSpan={row.getVisibleCells().length} style={{ padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>
                        <div className="flex items-center gap-2">
                          <span
                            style={{ cursor: 'pointer' }}
                            onClick={row.getToggleExpandedHandler()}
                          >
                            {row.getIsExpanded() ? '▼' : '▶'}
                          </span>
                          <span>
                            {row.groupingValue as string}
                          </span>
                          <span className="text-xs text-slate-400 font-normal">({row.subRows.length})</span>
                        </div>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => {
                      if (cell.getIsGrouped()) return null
                      // 修复：直接移除 placeholder 检查，或者在 grouped 场景下谨慎处理
                      // 在分组模式下，某些 cell 可能确实是 placeholder，但在渲染时应该安全
                      if (cell.getIsPlaceholder()) {
                        return (
                          <td key={cell.id} style={{
                            borderBottom: '1px solid var(--border-color)',
                            borderRight: '1px solid var(--border-color)',
                            padding: '3px 8px',
                          }} />
                        )
                      }
                      return (
                        <td
                          key={cell.id}
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                            borderRight: '1px solid var(--border-color)',
                            padding: '3px 8px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            width: `${cell.column.getSize()}px`,
                            minWidth: `${cell.column.getSize()}px`,
                            maxWidth: `${cell.column.getSize()}px`,
                            position: cell.column.getIsPinned() ? 'sticky' : undefined,
                            right: cell.column.getIsPinned() === 'right' ? 0 : undefined,
                            left: cell.column.getIsPinned() === 'left' ? 0 : undefined,
                            background: cell.column.getIsPinned() ? 'var(--bg-primary)' : undefined,
                            zIndex: cell.column.getIsPinned() ? 1 : undefined,
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {infos.length === 0 && <div className="text-sm text-slate-500 mt-2">暂无 Info</div>}
        </TabPage>
      ) : (
        renderDetail(activeTab)
      )}
    </PageLayout>
  )
}

const CellText = ({ children, maxWidth }: { children: React.ReactNode; maxWidth?: number }) => (
  <span
    style={{
      display: 'inline-block',
      maxWidth: maxWidth ? `${maxWidth}px` : '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {children}
  </span>
);

const TabPage = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* background: var(--bg-secondary); */
  /* border: 1px solid var(--border-color); */
  /* border-radius: var(--radius); */
  /* padding: 12px; */
  /* box-shadow: var(--shadow); */
  overflow-y: scroll;
`;

