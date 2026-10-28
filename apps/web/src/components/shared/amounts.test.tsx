import { render, screen } from '@testing-library/react';
import { MoneyAmount } from './MoneyAmount';
import { ProgressCell } from './ProgressCell';

describe('amounts', () => {
  it('shows euro with two decimals, or up to four for a unit price', () => {
    render(
      <>
        <MoneyAmount value="12345.5000" />
        <MoneyAmount value="0.1250" price />
      </>,
    );
    expect(screen.getByText(/12\.345,50\s€/)).toBeInTheDocument();
    expect(screen.getByText(/0,125\s€/)).toBeInTheDocument();
  });

  it('says the progress in words for screen readers, with the bar only for the eye', () => {
    render(<ProgressCell done="3" total="5" ratio={0.6} label="spediti 3 su 5" />);
    expect(screen.getByLabelText('spediti 3 su 5')).toHaveTextContent('3 / 5');
  });
});
