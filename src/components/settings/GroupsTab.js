'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Col, Form, Input, InputNumber, Modal, Row, Space, Table, App,
  Typography, Empty,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { inr } from '../ui/DataGrid.js';
import { api, keys } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';

const { Paragraph } = Typography;

/**
 * Units (यूनिट) — the groups a member can belong to.
 *
 * A unit carries its own per-closing amount and joining fee. Where a member's
 * योजना decides their rate by age band, a unit is the other way in: pick the
 * unit and the amounts follow.
 */
export default function GroupsTab() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: keys.groups, queryFn: () => api.groups.list() });

  const save = useMutation({
    mutationFn: (values) => api.groups.create(values),
    onSuccess: () => {
      message.success(t('यूनिट बन गई'));
      queryClient.invalidateQueries({ queryKey: keys.groups });
      form.resetFields();
      setOpen(false);
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <>
      <Paragraph type="secondary">
        {t('यूनिट से सदस्यों की दर तय होती है। सदस्य जोड़ते समय यूनिट चुनने पर उसकी राशि अपने-आप भर जाती है।')}
      </Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          {t('नई यूनिट')}
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.groups ?? []}
        pagination={false}
        locale={{ emptyText: <Empty description={t('कोई यूनिट नहीं')} /> }}
        columns={[
          { title: t('नाम'), dataIndex: 'name' },
          { title: t('विवरण'), dataIndex: 'description' },
          { title: t('प्रति क्लोजिंग'), dataIndex: 'payAmount', width: 140, render: (v) => inr(v) },
          { title: t('नामांकन शुल्क'), dataIndex: 'joinFees', width: 140, render: (v) => inr(v) },
          { title: t('सदस्य'), dataIndex: 'memberCount', width: 90, align: 'right' },
        ]}
      />

      <Modal
        title={t('नई यूनिट')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        okText={t('बनाएँ')}
        cancelText={t('रद्द')}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={save.mutate}
          initialValues={{ payAmount: 200, joinFees: 0 }}
        >
          <Form.Item name="name" label={t('नाम')} rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('विवरण')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="payAmount" label={t('प्रति क्लोजिंग राशि')}>
                <InputNumber min={1} prefix="₹" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="joinFees" label={t('नामांकन शुल्क')}>
                <InputNumber min={0} prefix="₹" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
